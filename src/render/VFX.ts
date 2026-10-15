import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NormalBlending,
  type PerspectiveCamera,
  PlaneGeometry,
  Points,
  Quaternion,
  type Scene,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Texture,
} from 'three';
import { clamp01, ease, Rng } from '../core/math';
import { canvasTexture, flareTexture, glowTexture, hexTexture, laneTexture, makeCanvas, puffTexture, raysTexture, ringTexture, scorchTexture, starTexture } from './textures';
import type { WeaponType } from '../config/types';

const _v = new Vector3();
const _v2 = new Vector3();
const _q = new Quaternion();
const _m = new Matrix4();
const _c = new Color();
const rng = new Rng(1234);

// ======================================================================= particles
class ParticlePool {
  readonly points: Points;
  private n: number;
  private next = 0;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private drag: Float32Array;
  private grav: Float32Array;
  private a0: Float32Array;
  private geo: BufferGeometry;
  readonly mat: ShaderMaterial;
  private active = 0;

  constructor(n: number, additive: boolean, tex: Texture) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.s0 = new Float32Array(n);
    this.s1 = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.a0 = new Float32Array(n);
    const geo = new BufferGeometry();
    const mk = (arr: Float32Array, k: number) => {
      const a = new BufferAttribute(arr, k);
      a.setUsage(DynamicDrawUsage);
      return a;
    };
    geo.setAttribute('position', mk(this.pos, 3));
    geo.setAttribute('color', mk(this.col, 3));
    geo.setAttribute('size', mk(this.size, 1));
    geo.setAttribute('alpha', mk(this.alpha, 1));
    this.geo = geo;
    this.mat = new ShaderMaterial({
      uniforms: { uScale: { value: 600 }, uMap: { value: tex } },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute float alpha;
        attribute vec3 color;
        uniform float uScale;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = size * uScale / max(0.1, -mv.z);
          vColor = color;
          vAlpha = alpha;
        }`,
      fragmentShader: additive
        ? /* glsl */ `
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).a;
          gl_FragColor = vec4(vColor * a * vAlpha, 1.0);
        }`
        : /* glsl */ `
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor, a);
        }`,
      blending: additive ? AdditiveBlending : NormalBlending,
      transparent: true,
      depthWrite: false,
    });
    this.points = new Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 5 : 4;
  }

  spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size0: number,
    size1: number,
    color: Color,
    intensity = 1,
    drag = 2,
    grav = 0,
  ): void {
    if (!Number.isFinite(x + y + z + vx + vy + vz)) return;
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.s0[i] = size0;
    this.s1[i] = size1;
    this.col[i * 3] = color.r * intensity;
    this.col[i * 3 + 1] = color.g * intensity;
    this.col[i * 3 + 2] = color.b * intensity;
    this.drag[i] = drag;
    this.grav[i] = grav;
    this.a0[i] = 1;
    this.active = Math.max(this.active, 1);
  }

  update(dt: number): void {
    let any = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) {
          this.alpha[i] = 0;
          this.size[i] = 0;
        }
        continue;
      }
      any++;
      this.life[i] -= dt;
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.02 && this.grav[i] > 0) {
        this.pos[i * 3 + 1] = 0.02;
        this.vel[i * 3 + 1] *= -0.35;
      }
      const t = 1 - this.life[i] / this.maxLife[i];
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.alpha[i] = this.life[i] <= 0 ? 0 : t < 0.1 ? t * 10 : 1 - ease.inQuad((t - 0.1) / 0.9);
    }
    if (any || this.active) {
      this.active = any;
      for (const name of ['position', 'color', 'size', 'alpha']) this.geo.getAttribute(name).needsUpdate = true;
    }
  }

  setScale(s: number): void {
    this.mat.uniforms.uScale.value = s;
  }
}

// ======================================================================== sprites
interface FlashItem {
  sprite: Sprite;
  life: number;
  max: number;
  s0: number;
  s1: number;
  spin: number;
}

class FlashPool {
  private items: FlashItem[] = [];
  private next = 0;
  constructor(group: Group, n: number, tex: Texture) {
    for (let i = 0; i < n; i++) {
      const mat = new SpriteMaterial({ map: tex, blending: AdditiveBlending, depthWrite: false, transparent: true });
      const s = new Sprite(mat);
      s.visible = false;
      s.renderOrder = 6;
      group.add(s);
      this.items.push({ sprite: s, life: 0, max: 1, s0: 1, s1: 1, spin: 0 });
    }
  }
  spawn(x: number, y: number, z: number, color: Color, intensity: number, s0: number, s1: number, life: number, spin = 0): void {
    const it = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    it.sprite.position.set(x, y, z);
    (it.sprite.material as SpriteMaterial).color.copy(color).multiplyScalar(intensity);
    (it.sprite.material as SpriteMaterial).rotation = rng.range(0, Math.PI * 2);
    it.life = life;
    it.max = life;
    it.s0 = s0;
    it.s1 = s1;
    it.spin = spin;
    it.sprite.visible = true;
    it.sprite.scale.setScalar(s0);
  }
  update(dt: number): void {
    for (const it of this.items) {
      if (it.life <= 0) continue;
      it.life -= dt;
      if (it.life <= 0) {
        it.sprite.visible = false;
        continue;
      }
      const t = 1 - it.life / it.max;
      it.sprite.scale.setScalar(it.s0 + (it.s1 - it.s0) * ease.outCubic(t));
      const m = it.sprite.material as SpriteMaterial;
      m.opacity = 1 - ease.inQuad(t);
      m.rotation += it.spin * dt;
    }
  }
}

// ========================================================================== rings
interface RingItem {
  mesh: Mesh;
  life: number;
  max: number;
  s0: number;
  s1: number;
}

class RingPool {
  private items: RingItem[] = [];
  private next = 0;
  constructor(group: Group, n: number) {
    const geo = new PlaneGeometry(1, 1);
    for (let i = 0; i < n; i++) {
      const mat = new MeshBasicMaterial({
        map: ringTexture(),
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      });
      const m = new Mesh(geo, mat);
      m.visible = false;
      m.renderOrder = 5;
      group.add(m);
      this.items.push({ mesh: m, life: 0, max: 1, s0: 1, s1: 1 });
    }
  }
  spawn(x: number, y: number, z: number, color: Color, intensity: number, s0: number, s1: number, life: number, flat = true): void {
    const it = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    it.mesh.position.set(x, y, z);
    if (flat) it.mesh.rotation.set(-Math.PI / 2, 0, 0);
    else it.mesh.rotation.set(-0.9, 0, 0);
    (it.mesh.material as MeshBasicMaterial).color.copy(color).multiplyScalar(intensity);
    it.life = life;
    it.max = life;
    it.s0 = s0;
    it.s1 = s1;
    it.mesh.visible = true;
  }
  update(dt: number): void {
    for (const it of this.items) {
      if (it.life <= 0) continue;
      it.life -= dt;
      if (it.life <= 0) {
        it.mesh.visible = false;
        continue;
      }
      const t = 1 - it.life / it.max;
      it.mesh.scale.setScalar(it.s0 + (it.s1 - it.s0) * ease.outCubic(t));
      (it.mesh.material as MeshBasicMaterial).opacity = 1 - t;
    }
  }
}

// ====================================================================== lightning
function beamTexture(): Texture {
  const { c, g } = makeCanvas(64, 16);
  const grd = g.createLinearGradient(0, 0, 0, 16);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.5, 'rgba(255,255,255,1)');
  grd.addColorStop(0.65, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 16);
  return canvasTexture(c);
}

const BOLT_SEG = 14;

interface Bolt {
  mesh: Mesh;
  geo: BufferGeometry;
  life: number;
  max: number;
  from: Vector3;
  to: Vector3;
  width: number;
  jitter: number;
  timer: number;
  pts: Vector3[];
}

class BoltPool {
  private items: Bolt[] = [];
  private next = 0;
  private camPos = new Vector3();
  constructor(group: Group, n: number) {
    const tex = beamTexture();
    for (let i = 0; i < n; i++) {
      const geo = new BufferGeometry();
      const pos = new Float32Array((BOLT_SEG + 1) * 2 * 3);
      const uv = new Float32Array((BOLT_SEG + 1) * 2 * 2);
      const idx: number[] = [];
      for (let s = 0; s <= BOLT_SEG; s++) {
        uv[s * 4] = s / BOLT_SEG;
        uv[s * 4 + 1] = 0;
        uv[s * 4 + 2] = s / BOLT_SEG;
        uv[s * 4 + 3] = 1;
        if (s < BOLT_SEG) {
          const a = s * 2;
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
      const pa = new BufferAttribute(pos, 3);
      pa.setUsage(DynamicDrawUsage);
      geo.setAttribute('position', pa);
      geo.setAttribute('uv', new BufferAttribute(uv, 2));
      geo.setIndex(idx);
      const mat = new MeshBasicMaterial({
        map: tex,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      });
      const mesh = new Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = 7;
      group.add(mesh);
      const pts: Vector3[] = [];
      for (let s = 0; s <= BOLT_SEG; s++) pts.push(new Vector3());
      this.items.push({ mesh, geo, life: 0, max: 1, from: new Vector3(), to: new Vector3(), width: 0.1, jitter: 0.3, timer: 0, pts });
    }
  }
  spawn(from: Vector3, to: Vector3, color: Color, intensity: number, width: number, life: number, jitter: number): void {
    if (!Number.isFinite(from.x + from.y + from.z + to.x + to.y + to.z)) return;
    const b = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    b.from.copy(from);
    b.to.copy(to);
    b.width = width;
    b.jitter = jitter;
    b.life = life;
    b.max = life;
    b.timer = 0;
    (b.mesh.material as MeshBasicMaterial).color.copy(color).multiplyScalar(intensity);
    b.mesh.visible = true;
    this.regen(b);
  }
  private regen(b: Bolt): void {
    const len = b.from.distanceTo(b.to);
    _v.subVectors(b.to, b.from);
    for (let s = 0; s <= BOLT_SEG; s++) {
      const t = s / BOLT_SEG;
      const env = Math.sin(t * Math.PI);
      b.pts[s].copy(b.from).addScaledVector(_v, t);
      if (s > 0 && s < BOLT_SEG) {
        b.pts[s].x += rng.range(-1, 1) * b.jitter * env * Math.min(1, len / 3);
        b.pts[s].y += rng.range(-1, 1) * b.jitter * env * 0.6 * Math.min(1, len / 3);
        b.pts[s].z += rng.range(-1, 1) * b.jitter * env * Math.min(1, len / 3);
      }
    }
  }
  setCamera(p: Vector3): void {
    this.camPos.copy(p);
  }
  update(dt: number): void {
    for (const b of this.items) {
      if (b.life <= 0) continue;
      b.life -= dt;
      if (b.life <= 0) {
        b.mesh.visible = false;
        continue;
      }
      b.timer -= dt;
      if (b.timer <= 0) {
        b.timer = 0.035;
        this.regen(b);
      }
      const pos = b.geo.getAttribute('position') as BufferAttribute;
      const arr = pos.array as Float32Array;
      const fade = b.life / b.max;
      const w = b.width * (0.4 + 0.6 * fade);
      for (let s = 0; s <= BOLT_SEG; s++) {
        const p = b.pts[s];
        const q = b.pts[Math.min(BOLT_SEG, s + 1)];
        const r = b.pts[Math.max(0, s - 1)];
        _v.subVectors(q, r);
        if (_v.lengthSq() < 1e-10) _v.set(1, 0, 0);
        _v.normalize();
        _v2.subVectors(this.camPos, p).normalize();
        _v.cross(_v2);
        if (_v.lengthSq() < 1e-10) _v.set(0, 1, 0);
        _v.normalize().multiplyScalar(w);
        arr[s * 6] = p.x - _v.x;
        arr[s * 6 + 1] = p.y - _v.y;
        arr[s * 6 + 2] = p.z - _v.z;
        arr[s * 6 + 3] = p.x + _v.x;
        arr[s * 6 + 4] = p.y + _v.y;
        arr[s * 6 + 5] = p.z + _v.z;
      }
      pos.needsUpdate = true;
      (b.mesh.material as MeshBasicMaterial).opacity = Math.min(1, fade * 2);
    }
  }
}

// ========================================================================== smoke
interface Puff {
  sprite: Sprite;
  ox: number;
  oz: number;
  oy: number;
  spin: number;
  scale: number;
}
interface Cloud {
  group: Group;
  puffs: Puff[];
  ring: Mesh;
  id: number;
  t: number;
  dur: number;
  active: boolean;
  radius: number;
}

class SmokePool {
  private clouds: Cloud[] = [];
  constructor(group: Group, n: number) {
    const tex = puffTexture();
    for (let i = 0; i < n; i++) {
      const g = new Group();
      g.visible = false;
      const puffs: Puff[] = [];
      const ring = new Mesh(
        new PlaneGeometry(1, 1),
        new MeshBasicMaterial({ map: ringTexture(), transparent: true, blending: AdditiveBlending, depthWrite: false, color: 0x9a90d8 }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.06;
      ring.renderOrder = 3;
      g.add(ring);
      for (let p = 0; p < 18; p++) {
        const mat = new SpriteMaterial({ map: tex, transparent: true, depthWrite: false, color: 0x8a86a8 });
        const s = new Sprite(mat);
        s.renderOrder = 8;
        g.add(s);
        puffs.push({ sprite: s, ox: 0, oz: 0, oy: 0, spin: 0, scale: 1 });
      }
      group.add(g);
      this.clouds.push({ group: g, puffs, ring, id: -1, t: 0, dur: 1, active: false, radius: 1 });
    }
  }
  spawn(id: number, x: number, z: number, radius: number, dur: number, tint: Color): void {
    const c = this.clouds.find((c) => !c.active) ?? this.clouds[0];
    c.active = true;
    c.id = id;
    c.t = 0;
    c.dur = dur;
    c.radius = radius;
    c.group.position.set(x, 0, z);
    c.group.visible = true;
    c.ring.scale.setScalar(radius * 2.25);
    (c.ring.material as MeshBasicMaterial).color.copy(tint).lerp(_c.set(0xb8b0ff), 0.5);
    for (const p of c.puffs) {
      const a = rng.range(0, Math.PI * 2);
      // bias puffs toward the rim so fighters inside stay readable
      const r = (0.35 + 0.65 * Math.sqrt(rng.next())) * radius * 0.85;
      p.ox = Math.cos(a) * r;
      p.oz = Math.sin(a) * r;
      p.oy = rng.range(0.3, 2.0);
      p.spin = rng.range(-0.6, 0.6);
      p.scale = rng.range(1.6, 2.6);
      const m = p.sprite.material as SpriteMaterial;
      _c.set(0x8a86a8).lerp(tint, 0.25).multiplyScalar(rng.range(0.75, 1.05));
      m.color.copy(_c);
      m.rotation = rng.range(0, 6);
    }
  }
  update(dt: number): void {
    for (const c of this.clouds) {
      if (!c.active) continue;
      c.t += dt;
      const fadeIn = ease.outCubic(clamp01(c.t / 0.35));
      const fadeOut = clamp01((c.dur - c.t) / 0.7);
      if (c.t >= c.dur) {
        c.active = false;
        c.group.visible = false;
        continue;
      }
      (c.ring.material as MeshBasicMaterial).opacity = 0.55 * fadeIn * fadeOut * (0.8 + 0.2 * Math.sin(c.t * 6));
      for (const p of c.puffs) {
        const m = p.sprite.material as SpriteMaterial;
        m.rotation += p.spin * dt;
        const drift = c.t * 0.12;
        p.sprite.position.set(p.ox * (0.6 + 0.4 * fadeIn) + Math.sin(c.t + p.oy) * drift, p.oy + c.t * 0.08, p.oz * (0.6 + 0.4 * fadeIn));
        p.sprite.scale.setScalar(p.scale * (0.4 + 0.6 * fadeIn) * (1 + c.t * 0.05));
        m.opacity = 0.5 * fadeIn * fadeOut;
      }
    }
  }
}

// ========================================================================== debris
class DebrisPool {
  private mesh: InstancedMesh;
  private n: number;
  private p: Float32Array;
  private v: Float32Array;
  private r: Float32Array;
  private w: Float32Array;
  private life: Float32Array;
  private size: Float32Array;
  private next = 0;
  constructor(group: Group, n: number) {
    this.n = n;
    this.mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshLambertMaterial({ color: 0xffffff }), n);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    for (let i = 0; i < n; i++) {
      _m.makeScale(0, 0, 0);
      this.mesh.setMatrixAt(i, _m);
      this.mesh.setColorAt(i, _c.setRGB(1, 1, 1));
    }
    group.add(this.mesh);
    this.p = new Float32Array(n * 3);
    this.v = new Float32Array(n * 3);
    this.r = new Float32Array(n * 3);
    this.w = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.size = new Float32Array(n);
  }
  spawn(x: number, y: number, z: number, color: Color, count: number, power = 1): void {
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      this.p[i * 3] = x + rng.range(-0.3, 0.3);
      this.p[i * 3 + 1] = y + rng.range(0, 0.6);
      this.p[i * 3 + 2] = z + rng.range(-0.3, 0.3);
      const a = rng.range(0, Math.PI * 2);
      const sp = rng.range(2, 6) * power;
      this.v[i * 3] = Math.cos(a) * sp;
      this.v[i * 3 + 1] = rng.range(3, 8) * power;
      this.v[i * 3 + 2] = Math.sin(a) * sp;
      for (let j = 0; j < 3; j++) {
        this.r[i * 3 + j] = rng.range(0, 6);
        this.w[i * 3 + j] = rng.range(-12, 12);
      }
      this.life[i] = rng.range(1.2, 2.2);
      this.size[i] = rng.range(0.08, 0.22);
      this.mesh.setColorAt(i, _c.copy(color).multiplyScalar(rng.range(0.6, 1.4)));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  update(dt: number): void {
    let changed = false;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      changed = true;
      this.life[i] -= dt;
      this.v[i * 3 + 1] -= 18 * dt;
      for (let j = 0; j < 3; j++) {
        this.p[i * 3 + j] += this.v[i * 3 + j] * dt;
        this.r[i * 3 + j] += this.w[i * 3 + j] * dt;
      }
      const s = this.size[i];
      if (this.p[i * 3 + 1] < s / 2) {
        this.p[i * 3 + 1] = s / 2;
        this.v[i * 3 + 1] *= -0.38;
        this.v[i * 3] *= 0.7;
        this.v[i * 3 + 2] *= 0.7;
        for (let j = 0; j < 3; j++) this.w[i * 3 + j] *= 0.6;
      }
      const k = this.life[i] <= 0 ? 0 : Math.min(1, this.life[i] / 0.4);
      _q.setFromAxisAngle(_v.set(this.r[i * 3], this.r[i * 3 + 1], this.r[i * 3 + 2]).normalize(), this.r[i * 3] + this.r[i * 3 + 2]);
      _m.compose(_v2.set(this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2]), _q, _v.set(s * k, s * k, s * k));
      this.mesh.setMatrixAt(i, _m);
    }
    if (changed) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ==================================================================== shield / aura
function makeShieldMaterial(color: Color): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: color.clone() },
      uTime: { value: 0 },
      uHit: { value: 0 },
      uHitDir: { value: new Vector3(0, 0, 1) },
      uAlpha: { value: 0 },
      uHex: { value: hexTexture() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      varying vec2 vUv;
      varying vec3 vObj;
      void main() {
        vUv = uv;
        vObj = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vV = -mv.xyz;
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uHit;
      uniform vec3 uHitDir;
      uniform float uAlpha;
      uniform sampler2D uHex;
      varying vec3 vN;
      varying vec3 vV;
      varying vec2 vUv;
      varying vec3 vObj;
      void main() {
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float fres = pow(f, 2.2);
        float hex = texture2D(uHex, vUv * vec2(6.0, 3.0) + vec2(uTime * 0.05, 0.0)).a;
        float scan = 0.5 + 0.5 * sin(vUv.y * 40.0 - uTime * 6.0);
        // ripple spreading from the impact point
        float d = 1.0 - dot(vObj, normalize(uHitDir));
        float wave = sin(d * 18.0 - (1.0 - uHit) * 22.0) * 0.5 + 0.5;
        float ripple = smoothstep(1.2, 0.0, d) * uHit * (0.6 + wave * 0.8);
        float a = fres * 1.3 + hex * (0.16 + ripple * 1.4) * (0.4 + fres) + scan * 0.04 + ripple * 0.9;
        gl_FragColor = vec4(uColor * a * uAlpha, 1.0);
      }`,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
}

function makeAuraMaterial(color: Color): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: color.clone() }, uTime: { value: 0 }, uAlpha: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vV = -mv.xyz;
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uAlpha;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vV;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p);
        float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
      }
      void main() {
        float n = noise(vec2(vUv.x * 10.0, vUv.y * 4.0 - uTime * 3.5));
        n += 0.5 * noise(vec2(vUv.x * 20.0, vUv.y * 8.0 - uTime * 6.0));
        float edge = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float h = 1.0 - vUv.y;
        float a = smoothstep(0.35, 1.2, n * h * 1.4) * (0.4 + edge);
        gl_FragColor = vec4(uColor * a * uAlpha * 2.0, 1.0);
      }`,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
}

// ========================================================================== trails
const TRAIL_N = 22;

/** Camera-facing ribbon that follows a point (dash / rush / speed buffs). */
export class Trail {
  readonly mesh: Mesh;
  private geo: BufferGeometry;
  private pts: Vector3[] = [];
  private ages: number[] = [];
  private head = 0;
  private count = 0;
  private emitT = 0;
  readonly color: Color;
  width = 0.5;
  life = 0.3;
  intensity = 2.2;

  constructor(group: Group, color: Color) {
    this.color = color.clone();
    for (let i = 0; i < TRAIL_N; i++) {
      this.pts.push(new Vector3());
      this.ages.push(99);
    }
    const geo = new BufferGeometry();
    const pos = new BufferAttribute(new Float32Array(TRAIL_N * 2 * 3), 3);
    const col = new BufferAttribute(new Float32Array(TRAIL_N * 2 * 3), 3);
    pos.setUsage(DynamicDrawUsage);
    col.setUsage(DynamicDrawUsage);
    geo.setAttribute('position', pos);
    geo.setAttribute('color', col);
    const idx: number[] = [];
    for (let i = 0; i < TRAIL_N - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(idx);
    this.geo = geo;
    this.mesh = new Mesh(
      geo,
      new MeshBasicMaterial({ vertexColors: true, blending: AdditiveBlending, transparent: true, depthWrite: false, side: DoubleSide }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 6;
    group.add(this.mesh);
  }

  clear(): void {
    for (let i = 0; i < TRAIL_N; i++) this.ages[i] = 99;
    this.count = 0;
    this.mesh.visible = false;
  }

  update(dt: number, at: Vector3, emit: boolean, camPos: Vector3): void {
    for (let i = 0; i < TRAIL_N; i++) this.ages[i] += dt;
    this.emitT -= dt;
    if (emit && this.emitT <= 0) {
      this.emitT = 0.016;
      this.head = (this.head + 1) % TRAIL_N;
      this.pts[this.head].copy(at);
      this.ages[this.head] = 0;
      this.count = Math.min(TRAIL_N, this.count + 1);
    }
    // collect live points newest -> oldest
    let live = 0;
    for (let k = 0; k < this.count; k++) {
      const i = (this.head - k + TRAIL_N) % TRAIL_N;
      if (this.ages[i] < this.life) live++;
      else break;
    }
    this.mesh.visible = live >= 2;
    if (!this.mesh.visible) return;
    const pos = this.geo.getAttribute('position') as BufferAttribute;
    const col = this.geo.getAttribute('color') as BufferAttribute;
    const pa = pos.array as Float32Array;
    const ca = col.array as Float32Array;
    for (let k = 0; k < TRAIL_N; k++) {
      const kk = Math.min(k, live - 1);
      const i = (this.head - kk + TRAIL_N) % TRAIL_N;
      const p = this.pts[i];
      const next = this.pts[(this.head - Math.min(kk + 1, live - 1) + TRAIL_N) % TRAIL_N];
      const prev = this.pts[(this.head - Math.max(kk - 1, 0) + TRAIL_N) % TRAIL_N];
      _v.subVectors(prev, next);
      if (_v.lengthSq() < 1e-8) _v.set(1, 0, 0);
      _v.normalize();
      _v2.subVectors(camPos, p).normalize();
      _v.cross(_v2);
      if (_v.lengthSq() < 1e-8) _v.set(0, 1, 0);
      const fade = k < live ? 1 - this.ages[i] / this.life : 0;
      const w = this.width * fade * (1 - kk / TRAIL_N) * 0.5;
      _v.normalize().multiplyScalar(w);
      pa[k * 6] = p.x - _v.x;
      pa[k * 6 + 1] = p.y - _v.y;
      pa[k * 6 + 2] = p.z - _v.z;
      pa[k * 6 + 3] = p.x + _v.x;
      pa[k * 6 + 4] = p.y + _v.y;
      pa[k * 6 + 5] = p.z + _v.z;
      const c = fade * fade * this.intensity;
      for (const o of [0, 3]) {
        ca[k * 6 + o] = this.color.r * c;
        ca[k * 6 + o + 1] = this.color.g * c;
        ca[k * 6 + o + 2] = this.color.b * c;
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }
}

// ========================================================================= scorches
interface Scorch {
  mesh: Mesh;
  life: number;
  max: number;
}

class ScorchPool {
  private items: Scorch[] = [];
  private next = 0;
  constructor(group: Group, n: number) {
    const geo = new PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < n; i++) {
      const m = new Mesh(geo, new MeshBasicMaterial({ map: scorchTexture(), transparent: true, depthWrite: false }));
      m.visible = false;
      m.renderOrder = 1;
      group.add(m);
      this.items.push({ mesh: m, life: 0, max: 1 });
    }
  }
  spawn(x: number, z: number, size: number, life: number): void {
    const it = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    it.mesh.position.set(x, 0.025 + this.next * 0.0008, z);
    it.mesh.rotation.y = rng.range(0, Math.PI * 2);
    it.mesh.scale.setScalar(size);
    it.life = life;
    it.max = life;
    it.mesh.visible = true;
  }
  update(dt: number): void {
    for (const it of this.items) {
      if (it.life <= 0) continue;
      it.life -= dt;
      if (it.life <= 0) {
        it.mesh.visible = false;
        continue;
      }
      (it.mesh.material as MeshBasicMaterial).opacity = Math.min(1, it.life / (it.max * 0.4));
    }
  }
}

export class FighterFX {
  readonly shield: Mesh;
  readonly shieldMat: ShaderMaterial;
  readonly aura: Mesh;
  readonly auraMat: ShaderMaterial;
  readonly lane: Mesh;
  readonly laneMat: MeshBasicMaterial;
  readonly ring: Mesh;
  readonly ringMat: MeshBasicMaterial;
  readonly charge: Sprite;
  readonly stars: Sprite[] = [];
  readonly trail: Trail;
  starsOn = 0;
  private shieldAge = 0;
  shieldOn = 0;
  auraOn = 0;
  laneOn = 0;
  laneLen = 8;
  laneWidth = 0.9;
  laneLocked = false;
  laneDirX = 0;
  laneDirZ = 1;
  chargeOn = 0;

  constructor(group: Group, teamColor: Color, accent: Color) {
    this.shieldMat = makeShieldMaterial(new Color(0x5ab8ff));
    this.shield = new Mesh(new SphereGeometry(1.1, 32, 18), this.shieldMat);
    this.shield.scale.set(1, 1.18, 1);
    this.shield.visible = false;
    this.shield.renderOrder = 9;
    group.add(this.shield);

    this.auraMat = makeAuraMaterial(new Color(0xff6a1a));
    const ag = new CylinderGeometry(0.75, 0.95, 2.6, 24, 1, true);
    ag.translate(0, 1.3, 0);
    this.aura = new Mesh(ag, this.auraMat);
    this.aura.visible = false;
    this.aura.renderOrder = 9;
    group.add(this.aura);

    this.laneMat = new MeshBasicMaterial({
      map: laneTexture(),
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
      color: teamColor.clone().multiplyScalar(1.4),
    });
    const lg = new PlaneGeometry(1, 1);
    lg.rotateX(-Math.PI / 2);
    lg.translate(0, 0, 0.5);
    this.lane = new Mesh(lg, this.laneMat);
    this.lane.visible = false;
    this.lane.renderOrder = 3;
    group.add(this.lane);

    this.ringMat = new MeshBasicMaterial({
      map: ringTexture(),
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
      color: teamColor.clone().multiplyScalar(1.6),
    });
    this.ring = new Mesh(new PlaneGeometry(1, 1), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    group.add(this.ring);

    this.charge = new Sprite(new SpriteMaterial({ map: glowTexture(), blending: AdditiveBlending, depthWrite: false, color: accent.clone().multiplyScalar(2) }));
    this.charge.visible = false;
    this.charge.renderOrder = 9;
    group.add(this.charge);

    for (let i = 0; i < 3; i++) {
      const st = new Sprite(new SpriteMaterial({ map: starTexture(), color: new Color(0xffe14d).multiplyScalar(1.6), transparent: true, depthWrite: false }));
      st.visible = false;
      st.renderOrder = 10;
      group.add(st);
      this.stars.push(st);
    }
    this.trail = new Trail(group, accent);
  }

  update(dt: number, t: number, x: number, z: number, aimX: number, aimZ: number, muzzle: Vector3): void {
    // shield (pops in with overshoot, ripples where it is struck)
    this.shield.visible = this.shieldOn > 0.01;
    if (this.shield.visible) {
      this.shieldAge += dt;
      this.shield.position.set(x, 1.05, z);
      this.shieldMat.uniforms.uTime.value = t;
      this.shieldMat.uniforms.uAlpha.value = this.shieldOn;
      this.shieldMat.uniforms.uHit.value = Math.max(0, this.shieldMat.uniforms.uHit.value - dt * 2.4);
      const pop = ease.outBack(clamp01(this.shieldAge / 0.28));
      const s = (0.55 + 0.45 * pop) * (0.85 + this.shieldOn * 0.15);
      this.shield.scale.set(s, s * 1.18, s);
    } else {
      this.shieldAge = 0;
    }
    // dizzy stars orbit the head while stunned
    const showStars = this.starsOn > 0.02;
    for (let i = 0; i < this.stars.length; i++) {
      const st = this.stars[i];
      st.visible = showStars;
      if (!showStars) continue;
      const a = t * 5 + (i / this.stars.length) * Math.PI * 2;
      st.position.set(x + Math.cos(a) * 0.55, 2.62 + Math.sin(t * 7 + i) * 0.06, z + Math.sin(a) * 0.35);
      st.scale.setScalar(0.32 * this.starsOn * (0.85 + 0.15 * Math.sin(t * 9 + i)));
      (st.material as SpriteMaterial).rotation = t * 3 + i;
    }
    this.aura.visible = this.auraOn > 0.01;
    if (this.aura.visible) {
      this.aura.position.set(x, 0, z);
      this.auraMat.uniforms.uTime.value = t;
      this.auraMat.uniforms.uAlpha.value = this.auraOn;
    }
    this.lane.visible = this.laneOn > 0.01;
    if (this.lane.visible) {
      const dx = this.laneLocked ? this.laneDirX : aimX - x;
      const dz = this.laneLocked ? this.laneDirZ : aimZ - z;
      const yaw = Math.atan2(dx, dz);
      this.lane.position.set(x, 0.05, z);
      this.lane.rotation.y = yaw;
      this.lane.scale.set(this.laneWidth, 1, this.laneLen);
      const pulse = this.laneLocked ? 0.85 + Math.sin(t * 40) * 0.15 : 0.45 + Math.sin(t * 18) * 0.2;
      this.laneMat.opacity = this.laneOn * pulse;
      this.laneMat.map!.offset.y = -t * 1.6;
    }
    this.ring.visible = this.laneOn > 0.01;
    if (this.ring.visible) {
      this.ring.position.set(x, 0.06, z);
      const s = 1.4 + (1 - this.laneOn) * 1.5;
      this.ring.scale.set(s, s, s);
      this.ringMat.opacity = this.laneOn;
    }
    this.charge.visible = this.chargeOn > 0.01;
    if (this.charge.visible) {
      this.charge.position.copy(muzzle);
      const s = 0.3 + this.chargeOn * 0.9 + Math.sin(t * 50) * 0.08;
      this.charge.scale.setScalar(s);
      (this.charge.material as SpriteMaterial).opacity = Math.min(1, this.chargeOn * 1.5);
    }
  }
}

// ===================================================================== glitch field
class GlitchField {
  readonly mesh: InstancedMesh;
  private n = 26;
  private seeds: Float32Array;
  on = 0;
  constructor(group: Group) {
    const mat = new MeshBasicMaterial({ color: 0xffffff, blending: AdditiveBlending, transparent: true, depthWrite: false });
    this.mesh = new InstancedMesh(new BoxGeometry(0.12, 0.12, 0.12), mat, this.n);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.seeds = new Float32Array(this.n * 3);
    const cols = [0xff4fd8, 0x22f0e0, 0x8a3cff, 0xffffff];
    for (let i = 0; i < this.n; i++) {
      this.seeds[i * 3] = rng.range(0, 6.28);
      this.seeds[i * 3 + 1] = rng.range(0.2, 2.2);
      this.seeds[i * 3 + 2] = rng.range(0.6, 1.3);
      this.mesh.setColorAt(i, _c.setHex(cols[i % cols.length]).multiplyScalar(2.2));
    }
    group.add(this.mesh);
  }
  setColor(c: Color): void {
    for (let i = 0; i < this.n; i++) {
      this.mesh.setColorAt(i, _c.copy(c).multiplyScalar(i % 3 === 0 ? 3 : 1.8));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  update(t: number, x: number, z: number): void {
    this.mesh.visible = this.on > 0.01;
    if (!this.mesh.visible) return;
    for (let i = 0; i < this.n; i++) {
      const a = this.seeds[i * 3] + t * (1.5 + (i % 3)) * (i % 2 ? 1 : -1);
      const y = this.seeds[i * 3 + 1] + Math.sin(t * 4 + i) * 0.15;
      const r = this.seeds[i * 3 + 2] * (0.7 + 0.3 * this.on);
      const jitter = Math.floor(t * 12 + i) % 7 === 0 ? 0.3 : 0;
      const s = (0.6 + 0.6 * Math.abs(Math.sin(t * 9 + i))) * this.on;
      _m.makeScale(s, s, s);
      _m.setPosition(x + Math.cos(a) * r + jitter, y, z + Math.sin(a) * r);
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ============================================================================= VFX
/** Central effects manager: pooled particles, flashes, rings, bolts, smoke, debris. */
export class VFX {
  readonly group = new Group();
  readonly sparks: ParticlePool;
  readonly soft: ParticlePool;
  private flashes: FlashPool;
  private glows: FlashPool;
  private rings: RingPool;
  readonly bolts: BoltPool;
  private smoke: SmokePool;
  private debris: DebrisPool;
  private scorches: ScorchPool;
  private raysPool: FlashPool;
  readonly fighterFX: FighterFX[] = [];
  readonly glitch: GlitchField[] = [];
  private t = 0;

  constructor(scene: Scene) {
    this.sparks = new ParticlePool(900, true, glowTexture());
    this.soft = new ParticlePool(360, false, puffTexture());
    this.group.add(this.sparks.points, this.soft.points);
    this.flashes = new FlashPool(this.group, 28, flareTexture());
    this.glows = new FlashPool(this.group, 20, glowTexture());
    this.rings = new RingPool(this.group, 20);
    this.bolts = new BoltPool(this.group, 18);
    this.smoke = new SmokePool(this.group, 3);
    this.debris = new DebrisPool(this.group, 90);
    this.scorches = new ScorchPool(this.group, 10);
    this.raysPool = new FlashPool(this.group, 6, raysTexture());
    for (let i = 0; i < 2; i++) this.glitch.push(new GlitchField(this.group));
    scene.add(this.group);
  }

  addFighterFX(team: Color, accent: Color): FighterFX {
    const f = new FighterFX(this.group, team, accent);
    this.fighterFX.push(f);
    return f;
  }

  setViewport(heightPx: number, fovDeg: number): void {
    const s = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
    this.sparks.setScale(s);
    this.soft.setScale(s);
  }

  // --------------------------------------------------------------- recipes
  burst(x: number, y: number, z: number, color: Color, count: number, speed: number, size = 0.18, life = 0.45, intensity = 2, grav = 0, up = 0): void {
    for (let i = 0; i < count; i++) {
      const a = rng.range(0, Math.PI * 2);
      const e = rng.range(-0.6, 1);
      const sp = speed * rng.range(0.35, 1);
      this.sparks.spawn(
        x,
        y,
        z,
        Math.cos(a) * Math.cos(e) * sp,
        Math.sin(e) * sp + up,
        Math.sin(a) * Math.cos(e) * sp,
        life * rng.range(0.6, 1.2),
        size * rng.range(0.7, 1.3),
        size * 0.2,
        color,
        intensity,
        3,
        grav,
      );
    }
  }

  cone(x: number, y: number, z: number, dx: number, dz: number, color: Color, count: number, speed: number, spread: number, size = 0.14, intensity = 2.2): void {
    const base = Math.atan2(dx, dz);
    for (let i = 0; i < count; i++) {
      const a = base + rng.range(-spread, spread);
      const sp = speed * rng.range(0.4, 1);
      this.sparks.spawn(x, y, z, Math.sin(a) * sp, rng.range(-0.5, 1.5), Math.cos(a) * sp, rng.range(0.15, 0.35), size, 0.02, color, intensity, 5);
    }
  }

  muzzle(p: Vector3, dx: number, dz: number, color: Color, heavy: boolean, big: boolean): void {
    const s = big ? 1.4 : 1;
    this.flashes.spawn(p.x, p.y, p.z, color, heavy ? 3 : 2.2, (heavy ? 1.2 : 0.55) * s, (heavy ? 2.2 : 0.9) * s, heavy ? 0.16 : 0.07);
    this.glows.spawn(p.x, p.y, p.z, color, 1.6, 0.6 * s, 1.4 * s, 0.1);
    this.cone(p.x, p.y, p.z, dx, dz, color, heavy ? 16 : big ? 8 : 4, heavy ? 9 : 6, heavy ? 0.6 : 0.35, 0.12 * s);
    if (big || heavy) {
      for (let i = 0; i < (heavy ? 5 : 3); i++) {
        this.soft.spawn(p.x + dx * 0.2, p.y, p.z + dz * 0.2, dx * 1.5 + rng.range(-0.5, 0.5), rng.range(0.2, 0.8), dz * 1.5 + rng.range(-0.5, 0.5), rng.range(0.4, 0.7), 0.35, 1.0, _c.set(0x6a6a80), 1, 3, -0.4);
      }
    }
  }

  impact(x: number, y: number, z: number, color: Color, heavy: boolean, crit: boolean): void {
    this.flashes.spawn(x, y, z, color, heavy ? 3.4 : 2.4, heavy ? 1.4 : 0.6, heavy ? 3.2 : 1.3, heavy ? 0.22 : 0.1, 3);
    this.glows.spawn(x, y, z, _c.set(0xffffff), heavy ? 2 : 1.2, heavy ? 1.2 : 0.5, heavy ? 2.6 : 1, heavy ? 0.18 : 0.08);
    this.burst(x, y, z, color, heavy ? 38 : 10, heavy ? 11 : 6, heavy ? 0.22 : 0.15, heavy ? 0.6 : 0.35, 2.4, heavy ? 6 : 0);
    if (heavy) {
      this.rings.spawn(x, 0.08, z, color, 2.2, 0.6, 5.5, 0.45);
      this.rings.spawn(x, y, z, _c.set(0xffffff), 1.6, 0.4, 3.2, 0.25, false);
      this.debris.spawn(x, 0.2, z, color, 6, 0.6);
    }
    if (crit) {
      this.burst(x, y, z, _c.set(0xffe14d), 24, 9, 0.2, 0.7, 2.6, 4, 2);
    }
  }

  wallHit(x: number, z: number, color: Color, heavy: boolean): void {
    this.flashes.spawn(x, 1, z, color, 2.2, 0.5, heavy ? 2.5 : 1.1, 0.12);
    this.burst(x, 1, z, color, heavy ? 20 : 6, heavy ? 7 : 4, 0.13, 0.35, 2, 8, 1);
  }

  ring(x: number, z: number, color: Color, s0: number, s1: number, life: number, intensity = 2): void {
    this.rings.spawn(x, 0.07, z, color, intensity, s0, s1, life);
  }

  flash(x: number, y: number, z: number, color: Color, s0: number, s1: number, life: number, intensity = 2.5): void {
    this.flashes.spawn(x, y, z, color, intensity, s0, s1, life, 2);
  }

  glow(x: number, y: number, z: number, color: Color, s0: number, s1: number, life: number, intensity = 2): void {
    this.glows.spawn(x, y, z, color, intensity, s0, s1, life);
  }

  bolt(from: Vector3, to: Vector3, color: Color, width = 0.12, life = 0.3, jitter = 0.5, intensity = 3): void {
    this.bolts.spawn(from, to, color, intensity, width, life, jitter);
  }

  dust(x: number, z: number, count: number, dirX = 0, dirZ = 0): void {
    for (let i = 0; i < count; i++) {
      this.soft.spawn(
        x + rng.range(-0.3, 0.3),
        0.12,
        z + rng.range(-0.3, 0.3),
        -dirX * rng.range(0.5, 2) + rng.range(-1, 1),
        rng.range(0.3, 1.1),
        -dirZ * rng.range(0.5, 2) + rng.range(-1, 1),
        rng.range(0.4, 0.8),
        0.3,
        0.9,
        _c.set(0x7f84a8),
        1,
        3,
        0,
      );
    }
  }

  smokeCloud(id: number, x: number, z: number, radius: number, dur: number, tint: Color): void {
    this.smoke.spawn(id, x, z, radius, dur, tint);
    for (let i = 0; i < 26; i++) {
      const a = rng.range(0, 6.28);
      this.soft.spawn(x, 0.3, z, Math.cos(a) * rng.range(2, 5), rng.range(0.5, 2), Math.sin(a) * rng.range(2, 5), rng.range(0.6, 1.1), 0.6, 1.6, _c.set(0x8a86a8), 1, 2.5, 0);
    }
  }

  debrisBurst(x: number, y: number, z: number, color: Color, count: number): void {
    this.debris.spawn(x, y, z, color, count, 1);
  }

  confetti(x: number, y: number, z: number, count: number): void {
    const cols = [0x22f0e0, 0xff7a1a, 0xff4fd8, 0xffe14d, 0x7aa8ff, 0xffffff];
    for (let i = 0; i < count; i++) {
      _c.setHex(cols[i % cols.length]);
      const a = rng.range(0, 6.28);
      const sp = rng.range(2, 7);
      this.sparks.spawn(x, y, z, Math.cos(a) * sp, rng.range(5, 11), Math.sin(a) * sp, rng.range(1.4, 2.6), 0.14, 0.1, _c, 1.6, 1.2, 6);
    }
  }

  /** Weapon-specific muzzle flash: crisp pistol pop, shotgun blast, rapid carbine flicker. */
  muzzleFor(weapon: WeaponType, p: Vector3, dx: number, dz: number, color: Color, heavy: boolean): void {
    if (heavy) {
      this.muzzle(p, dx, dz, color, true, weapon === 'boom_cannon');
      this.raysPool.spawn(p.x, p.y, p.z, color, 1.6, 0.6, 2.2, 0.18, 4);
      return;
    }
    switch (weapon) {
      case 'twin_blasters':
        this.flashes.spawn(p.x, p.y, p.z, color, 2.6, 0.42, 0.75, 0.05);
        this.glows.spawn(p.x, p.y, p.z, color, 1.4, 0.35, 0.9, 0.07);
        this.cone(p.x, p.y, p.z, dx, dz, color, 3, 7, 0.25, 0.1);
        break;
      case 'boom_cannon':
        this.flashes.spawn(p.x, p.y, p.z, color, 3, 1.1, 2.1, 0.11);
        this.glows.spawn(p.x, p.y, p.z, _c.set(0xffe0a0), 2, 0.8, 2, 0.12);
        this.cone(p.x, p.y, p.z, dx, dz, color, 14, 10, 0.55, 0.15);
        for (let i = 0; i < 4; i++) {
          this.soft.spawn(p.x + dx * 0.3, p.y, p.z + dz * 0.3, dx * 2 + rng.range(-0.6, 0.6), rng.range(0.2, 0.9), dz * 2 + rng.range(-0.6, 0.6), rng.range(0.5, 0.8), 0.4, 1.2, _c.set(0x6a6a80), 1, 3, -0.4);
        }
        break;
      case 'tech_carbine':
        this.flashes.spawn(p.x, p.y, p.z, color, 2.2, 0.3, 0.55, 0.04);
        for (let i = 0; i < 2; i++) {
          this.sparks.spawn(p.x, p.y, p.z, dx * 3 + rng.range(-1, 1), rng.range(-0.3, 1), dz * 3 + rng.range(-1, 1), 0.18, 0.12, 0.02, i ? _c.set(0x22f0e0) : color, 2.4, 6, 0);
        }
        break;
    }
  }

  /** Weapon-specific impact. */
  impactFor(weapon: WeaponType | null, x: number, y: number, z: number, color: Color, heavy: boolean, crit: boolean): void {
    if (heavy || weapon === null) {
      this.impact(x, y, z, color, heavy, crit);
      if (heavy) {
        this.scorches.spawn(x, z, crit ? 2.4 : 1.8, 3.2);
        this.raysPool.spawn(x, y, z, crit ? _c.set(0xffd23a) : color, 1.8, 0.8, crit ? 3.6 : 2.6, 0.28, 3);
      }
      return;
    }
    switch (weapon) {
      case 'twin_blasters':
        this.flashes.spawn(x, y, z, color, 2.4, 0.45, 1.0, 0.08, 3);
        this.burst(x, y, z, color, 8, 6, 0.13, 0.3, 2.4);
        break;
      case 'boom_cannon':
        this.flashes.spawn(x, y, z, _c.set(0xffc070), 2.2, 0.5, 1.1, 0.09, 2);
        this.burst(x, y, z, color, 6, 5, 0.15, 0.32, 2.4, 6);
        break;
      case 'tech_carbine':
        this.glows.spawn(x, y, z, color, 1.8, 0.4, 1, 0.1);
        for (let i = 0; i < 5; i++) {
          this.sparks.spawn(x + rng.range(-0.2, 0.2), y + rng.range(-0.2, 0.3), z + rng.range(-0.2, 0.2), rng.range(-1.5, 1.5), rng.range(0.5, 2.5), rng.range(-1.5, 1.5), rng.range(0.2, 0.4), 0.16, 0.16, i % 2 ? _c.set(0x22f0e0) : color, 2.4, 4, 0);
        }
        break;
    }
  }

  scorch(x: number, z: number, size: number, life = 3): void {
    this.scorches.spawn(x, z, size, life);
  }

  rays(x: number, y: number, z: number, color: Color, s0: number, s1: number, life: number, intensity = 2): void {
    this.raysPool.spawn(x, y, z, color, intensity, s0, s1, life, 1.5);
  }

  stepDust(x: number, z: number): void {
    for (let i = 0; i < 3; i++) {
      this.soft.spawn(x + rng.range(-0.25, 0.25), 0.08, z + rng.range(-0.25, 0.25), rng.range(-0.8, 0.8), rng.range(0.2, 0.6), rng.range(-0.8, 0.8), rng.range(0.35, 0.55), 0.22, 0.6, _c.set(0x6f7498), 1, 3, 0);
    }
  }

  landImpact(x: number, z: number, strength: number, color: Color): void {
    this.dust(x, z, Math.round(10 * strength));
    this.rings.spawn(x, 0.06, z, color, 1.6 * strength, 0.5, 3.4 * strength, 0.4);
    if (strength > 0.6) this.debris.spawn(x, 0.2, z, _c.set(0x2a3060), 6, 0.5);
  }

  update(dt: number, cam: PerspectiveCamera): void {
    this.t += dt;
    this.sparks.update(dt);
    this.soft.update(dt);
    this.flashes.update(dt);
    this.glows.update(dt);
    this.rings.update(dt);
    this.bolts.setCamera(cam.position);
    this.bolts.update(dt);
    this.smoke.update(dt);
    this.debris.update(dt);
    this.scorches.update(dt);
    this.raysPool.update(dt);
  }

  get time(): number {
    return this.t;
  }
}
