import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  type Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  type PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  BufferGeometry,
  Float32BufferAttribute,
  Vector3,
  type Texture,
} from 'three';
import { canvasTexture, glowTexture, makeCanvas, pumpkinSpriteTexture, ringTexture, starTexture } from './textures';

// Beta 2.7.5 — VFX & LEGENDARY STYLE: the pieces the cosmetic effects (cosmeticFx.ts) are built from beyond the shared
// sparks / glows / rings of VFX.ts. Every pool is made ONCE (with VFX — so the effects' warm-up compiles their shaders
// before a fight) and is drawn only while something of it plays: an idle pool is invisible (no draw call). The batches
// are instanced (one draw call for all their pieces); nothing allocates per frame. Pure visuals: no simulation here.

const _v = new Vector3();
const _v2 = new Vector3();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _m = new Matrix4();
const _c = new Color();
const _s = new Vector3();
const UP = new Vector3(0, 1, 0);
const DOWN = new Vector3(0, -1, 0);

/** A cheap repeatable hash in 0..1 (flicker and jitter without a random generator per frame). */
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// ======================================================================== textures
const texCache = new Map<string, Texture>();
function cachedTex(key: string, build: () => HTMLCanvasElement): Texture {
  let t = texCache.get(key);
  if (!t) {
    t = canvasTexture(build());
    texCache.set(key, t);
  }
  return t;
}

/** A bar with soft ends and a hard top / bottom edge (TV tear lines, pixels, signal bars). */
export function barTexture(): Texture {
  return cachedTex('fx-bar', () => {
    const { c, g } = makeCanvas(64, 16);
    const grd = g.createLinearGradient(0, 0, 64, 0);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.12, 'rgba(255,255,255,1)');
    grd.addColorStop(0.88, 'rgba(255,255,255,1)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 3, 64, 10);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(0, 1, 64, 2);
    g.fillRect(0, 13, 64, 2);
    return c;
  });
}

/** A hard square pixel with a thin bright rim (the broken signal's blocks). */
export function pixelTexture(): Texture {
  return cachedTex('fx-pixel', () => {
    const { c, g } = makeCanvas(16, 16);
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.fillRect(2, 2, 12, 12);
    g.fillStyle = '#ffffff';
    g.fillRect(2, 2, 12, 2);
    g.fillRect(2, 2, 2, 12);
    return c;
  });
}

/** A six-armed snowflake with side branches. */
export function snowflakeTexture(): Texture {
  return cachedTex('fx-snow', () => {
    const { c, g } = makeCanvas(64, 64);
    g.translate(32, 32);
    g.strokeStyle = '#ffffff';
    g.lineCap = 'round';
    g.shadowColor = '#bfefff';
    g.shadowBlur = 4;
    for (let i = 0; i < 6; i++) {
      g.save();
      g.rotate((i / 6) * Math.PI * 2);
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(0, -26);
      g.stroke();
      g.lineWidth = 2;
      for (const [y, l] of [
        [-10, 7],
        [-18, 6],
      ] as [number, number][]) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(-l, y - l);
        g.moveTo(0, y);
        g.lineTo(l, y - l);
        g.stroke();
      }
      g.restore();
    }
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(0, 0, 4, 0, Math.PI * 2);
    g.fill();
    return c;
  });
}

/** A bat silhouette, wings spread (two frames: up / down — the batch flaps by scaling its height). */
export function batSpriteTexture(): Texture {
  return cachedTex('fx-bat', () => {
    const { c, g } = makeCanvas(96, 48);
    g.translate(48, 26);
    g.fillStyle = '#1a0b22';
    g.strokeStyle = 'rgba(190,120,255,0.9)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(0, -10);
    g.lineTo(4, -15);
    g.lineTo(6, -8);
    g.quadraticCurveTo(22, -20, 44, -10);
    g.quadraticCurveTo(36, -4, 34, 4);
    g.quadraticCurveTo(26, -2, 20, 6);
    g.quadraticCurveTo(14, 0, 8, 8);
    g.lineTo(0, 14);
    g.lineTo(-8, 8);
    g.quadraticCurveTo(-14, 0, -20, 6);
    g.quadraticCurveTo(-26, -2, -34, 4);
    g.quadraticCurveTo(-36, -4, -44, -10);
    g.quadraticCurveTo(-22, -20, -6, -8);
    g.lineTo(-4, -15);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = '#ff4a6a';
    g.fillRect(-4, -8, 2, 2);
    g.fillRect(2, -8, 2, 2);
    return c;
  });
}

/** The retro studio sun: a coral-to-gold disc cut by horizontal bands (thinner towards the top), a soft halo. */
export function retroSunTexture(): Texture {
  return cachedTex('fx-sun', () => {
    const S = 256;
    const { c, g } = makeCanvas(S, S);
    const halo = g.createRadialGradient(128, 128, 70, 128, 128, 128);
    halo.addColorStop(0, 'rgba(255,150,90,0.55)');
    halo.addColorStop(1, 'rgba(255,90,90,0)');
    g.fillStyle = halo;
    g.fillRect(0, 0, S, S);
    const disc = g.createLinearGradient(0, 40, 0, 216);
    disc.addColorStop(0, '#ffe58a');
    disc.addColorStop(0.45, '#ffaa4a');
    disc.addColorStop(1, '#ff4a7a');
    g.fillStyle = disc;
    g.beginPath();
    g.arc(128, 128, 86, 0, Math.PI * 2);
    g.fill();
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 7; i++) {
      const y = 140 + i * 12;
      g.fillRect(0, y, S, 2 + i * 1.3);
    }
    g.globalCompositeOperation = 'source-over';
    return c;
  });
}

/** A gold clock face: a double rim, twelve ticks (long at the quarters), «XII» on top, a jewel in the middle. */
export function clockDialTexture(): Texture {
  return cachedTex('fx-dial', () => {
    const S = 256;
    const { c, g } = makeCanvas(S, S);
    g.translate(128, 128);
    const face = g.createRadialGradient(0, 0, 10, 0, 0, 112);
    face.addColorStop(0, 'rgba(40,60,120,0.55)');
    face.addColorStop(1, 'rgba(10,16,40,0.25)');
    g.fillStyle = face;
    g.beginPath();
    g.arc(0, 0, 112, 0, Math.PI * 2);
    g.fill();
    g.shadowColor = '#ffd36a';
    g.shadowBlur = 10;
    g.strokeStyle = '#ffd36a';
    g.lineWidth = 7;
    g.beginPath();
    g.arc(0, 0, 112, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 2.5;
    g.strokeStyle = '#fff2c4';
    g.beginPath();
    g.arc(0, 0, 100, 0, Math.PI * 2);
    g.stroke();
    for (let i = 0; i < 12; i++) {
      g.save();
      g.rotate((i / 12) * Math.PI * 2);
      g.fillStyle = i % 3 === 0 ? '#fff2c4' : '#ffd36a';
      const l = i % 3 === 0 ? 20 : 11;
      g.fillRect(-(i % 3 === 0 ? 4 : 2.5), -96, i % 3 === 0 ? 8 : 5, l);
      g.restore();
    }
    g.fillStyle = '#fff6d8';
    g.font = 'bold 30px Georgia, serif';
    g.textAlign = 'center';
    g.fillText('XII', 0, -54);
    g.fillStyle = '#7fe3ff';
    g.beginPath();
    g.arc(0, 0, 8, 0, Math.PI * 2);
    g.fill();
    return c;
  });
}

/** A clock hand drawn from the middle up (the sprite turns about its centre = the clock's axis). */
export function clockHandTexture(): Texture {
  return cachedTex('fx-hand', () => {
    const { c, g } = makeCanvas(32, 256);
    g.shadowColor = '#ffd36a';
    g.shadowBlur = 6;
    g.fillStyle = '#fff2c4';
    g.beginPath();
    g.moveTo(16, 18);
    g.lineTo(23, 128);
    g.lineTo(16, 140);
    g.lineTo(9, 128);
    g.closePath();
    g.fill();
    return c;
  });
}

/** A peppermint swirl: six red-and-white petals curling round a white centre. */
export function peppermintTexture(): Texture {
  return cachedTex('fx-mint', () => {
    const S = 128;
    const { c, g } = makeCanvas(S, S);
    g.translate(64, 64);
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.beginPath();
    g.arc(0, 0, 60, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ff2a44';
    for (let i = 0; i < 6; i++) {
      g.save();
      g.rotate((i / 6) * Math.PI * 2);
      g.beginPath();
      g.moveTo(0, 0);
      g.quadraticCurveTo(30, -10, 58, -18);
      g.arc(0, 0, 60, -0.31, -0.31 + 0.55);
      g.quadraticCurveTo(26, 8, 0, 0);
      g.fill();
      g.restore();
    }
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(0, 0, 60, 0, Math.PI * 2);
    g.stroke();
    return c;
  });
}

/** A pool of light on the floor: a hot centre, a soft rim and a faint outer ring. */
export function lightPoolTexture(): Texture {
  return cachedTex('fx-pool', () => {
    const { c, g } = makeCanvas(128, 128);
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.45, 'rgba(255,255,255,0.75)');
    grd.addColorStop(0.7, 'rgba(255,255,255,0.3)');
    grd.addColorStop(0.86, 'rgba(255,255,255,0.45)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    return c;
  });
}

/** A wave front: a thin bright arc of a ring (the signal travelling) — drawn on a vertical plane. */
export function waveTexture(): Texture {
  return cachedTex('fx-wave', () => {
    const { c, g } = makeCanvas(128, 128);
    g.translate(64, 64);
    g.shadowColor = '#ffffff';
    g.shadowBlur = 6;
    g.strokeStyle = '#ffffff';
    g.lineWidth = 5;
    g.beginPath();
    g.arc(0, 0, 54, Math.PI * 1.08, Math.PI * 1.92);
    g.stroke();
    g.lineWidth = 2;
    g.globalAlpha = 0.55;
    g.beginPath();
    g.arc(0, 0, 44, Math.PI * 1.15, Math.PI * 1.85);
    g.stroke();
    return c;
  });
}

/** Three rising signal bars (the INVITE SIGNAL «on air» mark). */
export function signalBarsTexture(): Texture {
  return cachedTex('fx-sig', () => {
    const { c, g } = makeCanvas(64, 64);
    g.shadowColor = '#ffffff';
    g.shadowBlur = 5;
    g.fillStyle = '#ffffff';
    for (let i = 0; i < 4; i++) {
      const h = 14 + i * 12;
      g.fillRect(8 + i * 13, 58 - h, 9, h);
    }
    return c;
  });
}

// ============================================================ instanced billboards
export interface BillboardSpawn {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  /** Seconds visible (after `delay`). */
  life: number;
  delay?: number;
  /** Width / height at the start and at the end. */
  w: number;
  h?: number;
  w1?: number;
  h1?: number;
  rot?: number;
  spin?: number;
  grav?: number;
  drag?: number;
  color: Color | number;
  intensity?: number;
  /** Visible / dim steps a second (TV dropouts); 0 = steady. */
  flicker?: number;
  /** Sideways jumps in metres at each flicker step (a torn signal). */
  jitter?: number;
  /** Side-to-side drift (falling flakes) in metres. */
  sway?: number;
  /** Height oscillation a second (a bat's wingbeat): 0 = none. */
  flap?: number;
  /** Circling a centre: radius, angular speed (rad/s), starting angle. */
  orbit?: { cx: number; cz: number; r: number; w: number; a: number };
  /** Fraction of the life to fade in (default 0.1). */
  fadeIn?: number;
}

/** Many textured camera-facing pieces in ONE draw call (instanced quads, their own small simulation). */
export class SpriteBatch {
  readonly mesh: Mesh;
  private n: number;
  private next = 0;
  private alive = 0;
  // GPU attributes
  private iPos: Float32Array;
  private iSize: Float32Array;
  private iRot: Float32Array;
  private iCol: Float32Array;
  private iAlpha: Float32Array;
  private attrs: InstancedBufferAttribute[];
  // simulation
  private p: Float32Array;
  private v: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private delay: Float32Array;
  private sz: Float32Array; // w0 h0 w1 h1
  private rot: Float32Array;
  private spin: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private col: Float32Array;
  private flick: Float32Array;
  private jit: Float32Array;
  private sway: Float32Array;
  private flap: Float32Array;
  private fadeIn: Float32Array;
  private orb: Float32Array; // cx cz r w a (r < 0: none)
  private seed: Float32Array;
  private t = 0;

  constructor(group: Group, n: number, tex: Texture, additive: boolean) {
    this.n = n;
    const base = new PlaneGeometry(1, 1);
    const geo = new InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    this.iPos = new Float32Array(n * 3);
    this.iSize = new Float32Array(n * 2);
    this.iRot = new Float32Array(n);
    this.iCol = new Float32Array(n * 3);
    this.iAlpha = new Float32Array(n);
    const mk = (a: Float32Array, k: number, name: string) => {
      const at = new InstancedBufferAttribute(a, k);
      at.setUsage(DynamicDrawUsage);
      geo.setAttribute(name, at);
      return at;
    };
    this.attrs = [mk(this.iPos, 3, 'iPos'), mk(this.iSize, 2, 'iSize'), mk(this.iRot, 1, 'iRot'), mk(this.iCol, 3, 'iCol'), mk(this.iAlpha, 1, 'iAlpha')];
    geo.instanceCount = n;
    const mat = new ShaderMaterial({
      uniforms: { uMap: { value: tex } },
      vertexShader: /* glsl */ `
        attribute vec3 iPos;
        attribute vec2 iSize;
        attribute float iRot;
        attribute vec3 iCol;
        attribute float iAlpha;
        varying vec2 vUv;
        varying vec3 vCol;
        varying float vAlpha;
        void main() {
          vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
          vec2 q = position.xy * iSize;
          float c = cos(iRot), s = sin(iRot);
          mv.xy += vec2(c * q.x - s * q.y, s * q.x + c * q.y);
          gl_Position = projectionMatrix * mv;
          vUv = uv;
          vCol = iCol;
          vAlpha = iAlpha;
        }`,
      fragmentShader: additive
        ? /* glsl */ `
        uniform sampler2D uMap;
        varying vec2 vUv;
        varying vec3 vCol;
        varying float vAlpha;
        void main() {
          vec4 t = texture2D(uMap, vUv);
          float a = t.a * vAlpha;
          if (a < 0.004) discard;
          gl_FragColor = vec4(vCol * t.rgb * a, 1.0);
        }`
        : /* glsl */ `
        uniform sampler2D uMap;
        varying vec2 vUv;
        varying vec3 vCol;
        varying float vAlpha;
        void main() {
          vec4 t = texture2D(uMap, vUv);
          float a = t.a * vAlpha;
          if (a < 0.02) discard;
          gl_FragColor = vec4(vCol * t.rgb, a);
        }`,
      blending: additive ? AdditiveBlending : NormalBlending,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = additive ? 6 : 4;
    group.add(this.mesh);
    this.p = new Float32Array(n * 3);
    this.v = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n);
    this.delay = new Float32Array(n);
    this.sz = new Float32Array(n * 4);
    this.rot = new Float32Array(n);
    this.spin = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.col = new Float32Array(n * 3);
    this.flick = new Float32Array(n);
    this.jit = new Float32Array(n);
    this.sway = new Float32Array(n);
    this.flap = new Float32Array(n);
    this.fadeIn = new Float32Array(n);
    this.orb = new Float32Array(n * 5);
    this.seed = new Float32Array(n);
  }

  spawn(o: BillboardSpawn): void {
    if (!Number.isFinite(o.x + o.y + o.z)) return;
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.p[i * 3] = o.x;
    this.p[i * 3 + 1] = o.y;
    this.p[i * 3 + 2] = o.z;
    this.v[i * 3] = o.vx ?? 0;
    this.v[i * 3 + 1] = o.vy ?? 0;
    this.v[i * 3 + 2] = o.vz ?? 0;
    this.life[i] = o.life;
    this.max[i] = o.life;
    this.delay[i] = o.delay ?? 0;
    const h = o.h ?? o.w;
    this.sz[i * 4] = o.w;
    this.sz[i * 4 + 1] = h;
    this.sz[i * 4 + 2] = o.w1 ?? o.w;
    this.sz[i * 4 + 3] = o.h1 ?? h;
    this.rot[i] = o.rot ?? 0;
    this.spin[i] = o.spin ?? 0;
    this.grav[i] = o.grav ?? 0;
    this.drag[i] = o.drag ?? 0;
    const c = typeof o.color === 'number' ? _c.setHex(o.color) : o.color;
    const k = o.intensity ?? 1;
    this.col[i * 3] = c.r * k;
    this.col[i * 3 + 1] = c.g * k;
    this.col[i * 3 + 2] = c.b * k;
    this.flick[i] = o.flicker ?? 0;
    this.jit[i] = o.jitter ?? 0;
    this.sway[i] = o.sway ?? 0;
    this.flap[i] = o.flap ?? 0;
    this.fadeIn[i] = o.fadeIn ?? 0.1;
    if (o.orbit) {
      this.orb[i * 5] = o.orbit.cx;
      this.orb[i * 5 + 1] = o.orbit.cz;
      this.orb[i * 5 + 2] = o.orbit.r;
      this.orb[i * 5 + 3] = o.orbit.w;
      this.orb[i * 5 + 4] = o.orbit.a;
    } else this.orb[i * 5 + 2] = -1;
    this.seed[i] = Math.random() * 100;
    this.alive++;
    this.mesh.visible = true;
  }

  update(dt: number): void {
    if (!this.mesh.visible) return;
    this.t += dt;
    let live = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) {
        if (this.iAlpha[i] !== 0) {
          this.iAlpha[i] = 0;
          this.iSize[i * 2] = 0;
          this.iSize[i * 2 + 1] = 0;
        }
        continue;
      }
      live++;
      if (this.delay[i] > 0) {
        this.delay[i] -= dt;
        this.iAlpha[i] = 0;
        this.iSize[i * 2] = 0;
        this.iSize[i * 2 + 1] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = Math.exp(-this.drag[i] * dt);
      this.v[i * 3] *= k;
      this.v[i * 3 + 1] = this.v[i * 3 + 1] * k - this.grav[i] * dt;
      this.v[i * 3 + 2] *= k;
      this.p[i * 3] += this.v[i * 3] * dt;
      this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt;
      this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      this.rot[i] += this.spin[i] * dt;
      const t = 1 - Math.max(0, this.life[i]) / this.max[i];
      let x = this.p[i * 3];
      const y = this.p[i * 3 + 1];
      let z = this.p[i * 3 + 2];
      if (this.orb[i * 5 + 2] >= 0) {
        const a = this.orb[i * 5 + 4] + this.orb[i * 5 + 3] * (this.max[i] - this.life[i]);
        const r = this.orb[i * 5 + 2];
        x = this.orb[i * 5] + Math.cos(a) * r;
        z = this.orb[i * 5 + 1] + Math.sin(a) * r;
      }
      if (this.sway[i] > 0) {
        const ph = this.seed[i] + this.t * 2.3;
        x += Math.sin(ph) * this.sway[i];
        z += Math.cos(ph * 0.8) * this.sway[i] * 0.6;
      }
      let a = this.life[i] <= 0 ? 0 : t < this.fadeIn[i] ? t / Math.max(0.001, this.fadeIn[i]) : 1 - Math.pow((t - this.fadeIn[i]) / (1 - this.fadeIn[i]), 2);
      if (this.flick[i] > 0) {
        const step = Math.floor(this.t * this.flick[i] + this.seed[i]);
        const on = hash(step + this.seed[i]);
        a *= on > 0.3 ? 1 : 0.12;
        if (this.jit[i] > 0) x += (hash(step * 1.7 + this.seed[i]) - 0.5) * 2 * this.jit[i];
      }
      this.iPos[i * 3] = x;
      this.iPos[i * 3 + 1] = y;
      this.iPos[i * 3 + 2] = z;
      let w = this.sz[i * 4] + (this.sz[i * 4 + 2] - this.sz[i * 4]) * t;
      let h = this.sz[i * 4 + 1] + (this.sz[i * 4 + 3] - this.sz[i * 4 + 1]) * t;
      if (this.flap[i] > 0) h *= 0.35 + 0.65 * Math.abs(Math.sin(this.t * this.flap[i] + this.seed[i]));
      if (a <= 0) w = h = 0;
      this.iSize[i * 2] = w;
      this.iSize[i * 2 + 1] = h;
      this.iRot[i] = this.rot[i];
      this.iCol[i * 3] = this.col[i * 3];
      this.iCol[i * 3 + 1] = this.col[i * 3 + 1];
      this.iCol[i * 3 + 2] = this.col[i * 3 + 2];
      this.iAlpha[i] = Math.max(0, a);
    }
    for (const at of this.attrs) at.needsUpdate = true;
    if (!live) {
      this.alive = 0;
      this.mesh.visible = false;
    }
  }

  get active(): number {
    return this.alive && this.mesh.visible ? this.alive : 0;
  }
}

// ==================================================================== paper confetti
/**
 * Real confetti: flat paper pieces (rectangles and squares) that tumble, flutter and sink slowly, catching the light as
 * they turn (each piece's brightness follows how squarely it faces the camera — the shimmer of foil; no scene lights
 * needed, so it reads the same in every set). One draw call; hidden when nothing falls.
 */
export class PaperPool {
  readonly mesh: InstancedMesh;
  private n: number;
  private next = 0;
  private p: Float32Array;
  private v: Float32Array;
  private ax: Float32Array; // tumble axis (3) + speed
  private ang: Float32Array;
  private sz: Float32Array; // w h
  private base: Float32Array; // colour
  private life: Float32Array;
  private max: Float32Array;
  private delay: Float32Array;
  private ph: Float32Array;
  private camPos = new Vector3();
  private any = false;

  constructor(group: Group, n: number) {
    this.n = n;
    this.mesh = new InstancedMesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide }), n);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 3;
    for (let i = 0; i < n; i++) {
      _m.makeScale(0, 0, 0);
      this.mesh.setMatrixAt(i, _m);
      this.mesh.setColorAt(i, _c.setRGB(1, 1, 1));
    }
    this.mesh.instanceColor!.setUsage(DynamicDrawUsage);
    group.add(this.mesh);
    this.p = new Float32Array(n * 3);
    this.v = new Float32Array(n * 3);
    this.ax = new Float32Array(n * 4);
    this.ang = new Float32Array(n);
    this.sz = new Float32Array(n * 2);
    this.base = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n);
    this.delay = new Float32Array(n);
    this.ph = new Float32Array(n);
  }

  /** One piece: position, velocity, colour, life; `size` ≈ the long side (m); `delay` before it shows. */
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: number, life: number, size = 0.09, delay = 0): void {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.p[i * 3] = x;
    this.p[i * 3 + 1] = y;
    this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx;
    this.v[i * 3 + 1] = vy;
    this.v[i * 3 + 2] = vz;
    _v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    this.ax[i * 4] = _v.x;
    this.ax[i * 4 + 1] = _v.y;
    this.ax[i * 4 + 2] = _v.z;
    this.ax[i * 4 + 3] = 5 + Math.random() * 9;
    this.ang[i] = Math.random() * 6.28;
    const sq = Math.random() < 0.35;
    this.sz[i * 2] = size * (sq ? 0.7 : 1);
    this.sz[i * 2 + 1] = size * (sq ? 0.7 : 0.45);
    _c.setHex(color);
    this.base[i * 3] = _c.r;
    this.base[i * 3 + 1] = _c.g;
    this.base[i * 3 + 2] = _c.b;
    this.life[i] = life;
    this.max[i] = life;
    this.delay[i] = delay;
    this.ph[i] = Math.random() * 6.28;
    this.any = true;
    this.mesh.visible = true;
  }

  setCamera(p: Vector3): void {
    this.camPos.copy(p);
  }

  update(dt: number): void {
    if (!this.any) return;
    let live = false;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      live = true;
      if (this.delay[i] > 0) {
        this.delay[i] -= dt;
        continue;
      }
      this.life[i] -= dt;
      // air: a strong drag sideways, a terminal sink of about 1.2 m/s, a flutter on top
      const kx = Math.exp(-1.6 * dt);
      this.v[i * 3] *= kx;
      this.v[i * 3 + 2] *= kx;
      this.v[i * 3 + 1] = Math.max(-1.25, this.v[i * 3 + 1] * Math.exp(-1.1 * dt) - 6.5 * dt);
      this.ph[i] += dt * 4.2;
      const flut = Math.sin(this.ph[i]) * 0.6;
      this.p[i * 3] += (this.v[i * 3] + flut * 0.5) * dt;
      this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt;
      this.p[i * 3 + 2] += (this.v[i * 3 + 2] + Math.cos(this.ph[i] * 0.7) * 0.25) * dt;
      if (this.p[i * 3 + 1] < 0.03) {
        this.p[i * 3 + 1] = 0.03;
        this.v[i * 3] = this.v[i * 3 + 1] = this.v[i * 3 + 2] = 0;
        this.ax[i * 4 + 3] *= 0.9;
      }
      this.ang[i] += this.ax[i * 4 + 3] * dt;
      _q.setFromAxisAngle(_v.set(this.ax[i * 4], this.ax[i * 4 + 1], this.ax[i * 4 + 2]), this.ang[i]);
      const fade = this.life[i] <= 0 ? 0 : Math.min(1, this.life[i] / 0.5);
      _s.set(this.sz[i * 2] * fade, this.sz[i * 2 + 1] * fade, 1);
      _v2.set(this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2]);
      _m.compose(_v2, _q, _s);
      this.mesh.setMatrixAt(i, _m);
      // the foil glint: bright when the piece faces the camera, darker edge-on
      _v.set(0, 0, 1).applyQuaternion(_q);
      _v2.sub(this.camPos).normalize();
      const f = Math.abs(_v.dot(_v2));
      const b = 0.42 + 0.95 * f * f;
      this.mesh.setColorAt(i, _c.setRGB(this.base[i * 3] * b, this.base[i * 3 + 1] * b, this.base[i * 3 + 2] * b));
    }
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] > 0 || this.max[i] === 0) continue;
      // retired this frame: collapse it once
      this.max[i] = 0;
      _m.makeScale(0, 0, 0);
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
    if (!live) {
      this.any = false;
      this.mesh.visible = false;
    }
  }
}

// ======================================================================== streamers
/** A corkscrew ribbon (one geometry for all): a strip wound round a narrow helix, about 0.8 m long. */
function ribbonGeometry(): BufferGeometry {
  const seg = 28;
  const L = 0.8;
  const r = 0.07;
  const turns = 2.4;
  const w = 0.035;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const u = i / seg;
    const a = u * turns * Math.PI * 2;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const y = -u * L;
    // the strip's width runs along the helix axis' tangent across (radial), so it twists as it winds
    const nx = Math.cos(a);
    const nz = Math.sin(a);
    pos.push(cx - nx * w, y + w * 0.4, cz - nz * w, cx + nx * w, y - w * 0.4, cz + nz * w);
    if (i < seg) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Curling foil streamers that sink slowly while they turn (GOLDEN CONFETTI). One draw call. */
export class RibbonPool {
  readonly mesh: InstancedMesh;
  private n: number;
  private next = 0;
  private p: Float32Array;
  private v: Float32Array;
  private yaw: Float32Array;
  private spin: Float32Array;
  private tilt: Float32Array;
  private base: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private delay: Float32Array;
  private any = false;

  constructor(group: Group, n: number) {
    this.n = n;
    this.mesh = new InstancedMesh(ribbonGeometry(), new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide }), n);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 3;
    for (let i = 0; i < n; i++) {
      _m.makeScale(0, 0, 0);
      this.mesh.setMatrixAt(i, _m);
      this.mesh.setColorAt(i, _c.setRGB(1, 1, 1));
    }
    this.mesh.instanceColor!.setUsage(DynamicDrawUsage);
    group.add(this.mesh);
    this.p = new Float32Array(n * 3);
    this.v = new Float32Array(n * 3);
    this.yaw = new Float32Array(n);
    this.spin = new Float32Array(n);
    this.tilt = new Float32Array(n);
    this.base = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n);
    this.delay = new Float32Array(n);
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: number, life: number, delay = 0): void {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.p[i * 3] = x;
    this.p[i * 3 + 1] = y;
    this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx;
    this.v[i * 3 + 1] = vy;
    this.v[i * 3 + 2] = vz;
    this.yaw[i] = Math.random() * 6.28;
    this.spin[i] = (Math.random() < 0.5 ? -1 : 1) * (2.5 + Math.random() * 3);
    this.tilt[i] = (Math.random() - 0.5) * 0.6;
    _c.setHex(color);
    this.base[i * 3] = _c.r;
    this.base[i * 3 + 1] = _c.g;
    this.base[i * 3 + 2] = _c.b;
    this.life[i] = life;
    this.max[i] = life;
    this.delay[i] = delay;
    this.any = true;
    this.mesh.visible = true;
  }

  update(dt: number, t: number): void {
    if (!this.any) return;
    let live = false;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) {
        if (this.max[i] !== 0) {
          this.max[i] = 0;
          _m.makeScale(0, 0, 0);
          this.mesh.setMatrixAt(i, _m);
        }
        continue;
      }
      live = true;
      if (this.delay[i] > 0) {
        this.delay[i] -= dt;
        continue;
      }
      this.life[i] -= dt;
      const kx = Math.exp(-1.4 * dt);
      this.v[i * 3] *= kx;
      this.v[i * 3 + 2] *= kx;
      this.v[i * 3 + 1] = Math.max(-0.9, this.v[i * 3 + 1] * Math.exp(-0.9 * dt) - 5.5 * dt);
      for (let k = 0; k < 3; k++) this.p[i * 3 + k] += this.v[i * 3 + k] * dt;
      if (this.p[i * 3 + 1] < 0.85) {
        this.p[i * 3 + 1] = 0.85;
        this.v[i * 3 + 1] = 0;
      }
      this.yaw[i] += this.spin[i] * dt;
      _q.setFromAxisAngle(UP, this.yaw[i]);
      _q2.setFromAxisAngle(_v.set(1, 0, 0), this.tilt[i] + Math.sin(t * 2 + i) * 0.15);
      _q.multiply(_q2);
      const fade = this.life[i] <= 0 ? 0 : Math.min(1, this.life[i] / 0.5);
      _s.setScalar(fade);
      _m.compose(_v2.set(this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2]), _q, _s);
      this.mesh.setMatrixAt(i, _m);
      const b = 0.7 + 0.45 * Math.abs(Math.sin(this.yaw[i] * 2));
      this.mesh.setColorAt(i, _c.setRGB(this.base[i * 3] * b, this.base[i * 3 + 1] * b, this.base[i * 3 + 2] * b));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
    if (!live) {
      this.any = false;
      this.mesh.visible = false;
    }
  }
}

// ==================================================================== spotlight cones
interface Beam {
  mesh: Mesh;
  mat: ShaderMaterial;
  life: number;
  max: number;
  delay: number;
  from: Vector3;
  aim0: Vector3;
  aim1: Vector3;
  sweep: number;
  width: number;
}

/**
 * Studio spotlight beams: open cones of light from a lamp to the floor — brightest along the axis and near the lamp,
 * soft at the rim (seen edge-on a cone of light is thin and faint). Each beam can sweep from one floor point to
 * another before it settles. Additive, no shadows, a handful at most.
 */
export class BeamPool {
  private items: Beam[] = [];
  private next = 0;
  constructor(group: Group, n: number) {
    const geo = new CylinderGeometry(0.05, 1, 1, 28, 1, true);
    geo.translate(0, -0.5, 0);
    for (let i = 0; i < n; i++) {
      const mat = new ShaderMaterial({
        uniforms: { uColor: { value: new Color() }, uOpacity: { value: 0 } },
        vertexShader: /* glsl */ `
          varying float vV;
          varying vec3 vN;
          varying vec3 vView;
          void main() {
            vV = -position.y;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vView = -mv.xyz;
            vN = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uOpacity;
          varying float vV;
          varying vec3 vN;
          varying vec3 vView;
          void main() {
            float face = abs(dot(normalize(vN), normalize(vView)));
            float core = pow(face, 3.2);
            float along = (1.0 - vV * 0.7) * smoothstep(0.0, 0.06, vV);
            float a = core * along * uOpacity;
            gl_FragColor = vec4(uColor * a, 1.0);
          }`,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      });
      const mesh = new Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 6;
      group.add(mesh);
      this.items.push({ mesh, mat, life: 0, max: 1, delay: 0, from: new Vector3(), aim0: new Vector3(), aim1: new Vector3(), sweep: 0.5, width: 0.7 });
    }
  }

  /** A lamp at `from`, its pool of light moving from `aim0` to `aim1` over `sweep` s, then holding; `width` = floor radius. */
  spawn(from: Vector3, aim0: Vector3, aim1: Vector3, color: Color | number, intensity: number, width: number, life: number, sweep: number, delay = 0): void {
    const b = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    b.from.copy(from);
    b.aim0.copy(aim0);
    b.aim1.copy(aim1);
    (typeof color === 'number' ? b.mat.uniforms.uColor.value.setHex(color) : b.mat.uniforms.uColor.value.copy(color)).multiplyScalar(intensity);
    b.life = life;
    b.max = life;
    b.delay = delay;
    b.sweep = sweep;
    b.width = width;
    b.mat.uniforms.uOpacity.value = 0;
    b.mesh.visible = delay <= 0;
  }

  update(dt: number): void {
    for (const b of this.items) {
      if (b.life <= 0) continue;
      if (b.delay > 0) {
        b.delay -= dt;
        if (b.delay > 0) continue;
        b.mesh.visible = true;
      }
      b.life -= dt;
      if (b.life <= 0) {
        b.mesh.visible = false;
        continue;
      }
      const age = b.max - b.life;
      const k = b.sweep > 0 ? Math.min(1, age / b.sweep) : 1;
      const e = k * k * (3 - 2 * k);
      _v.copy(b.aim0).lerp(b.aim1, e);
      _v2.subVectors(_v, b.from);
      const len = _v2.length();
      _v2.divideScalar(len || 1);
      b.mesh.position.copy(b.from);
      b.mesh.quaternion.setFromUnitVectors(DOWN, _v2);
      b.mesh.scale.set(b.width, len, b.width);
      const t = age / b.max;
      b.mat.uniforms.uOpacity.value = Math.min(1, age / 0.18) * (t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1);
    }
  }
}

// ======================================================================== decals
interface Decal {
  mesh: Mesh;
  mat: MeshBasicMaterial;
  life: number;
  max: number;
  delay: number;
  s0: number;
  s1: number;
  spin: number;
  fadeIn: number;
  vy: number;
}

/**
 * Flat textured planes: on the floor (a pool of light, a peppermint swirl) or standing up across a path (a wave of the
 * signal). Each piece takes its texture at spawn. A few at most; hidden when idle.
 */
export class DecalPool {
  private items: Decal[] = [];
  private next = 0;
  constructor(group: Group, n: number) {
    const geo = new PlaneGeometry(1, 1);
    for (let i = 0; i < n; i++) {
      const mat = new MeshBasicMaterial({ map: glowTexture(), blending: AdditiveBlending, transparent: true, depthWrite: false, side: DoubleSide });
      const mesh = new Mesh(geo, mat);
      mesh.visible = false;
      mesh.renderOrder = 5;
      group.add(mesh);
      this.items.push({ mesh, mat, life: 0, max: 1, delay: 0, s0: 1, s1: 1, spin: 0, fadeIn: 0.15, vy: 0 });
    }
  }

  /**
   * `yaw` null: flat on the floor; a number: standing, facing along that direction (radians about Y, 0 = +Z).
   * Sizes are the plane's side at the start / end.
   */
  spawn(tex: Texture, x: number, y: number, z: number, yaw: number | null, color: Color | number, intensity: number, s0: number, s1: number, life: number, opts: { spin?: number; delay?: number; fadeIn?: number; vy?: number } = {}): void {
    const d = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    d.mat.map = tex;
    (typeof color === 'number' ? d.mat.color.setHex(color) : d.mat.color.copy(color)).multiplyScalar(intensity);
    d.mesh.position.set(x, y, z);
    if (yaw === null) d.mesh.rotation.set(-Math.PI / 2, 0, 0);
    else d.mesh.rotation.set(0, yaw, 0);
    d.life = life;
    d.max = life;
    d.delay = opts.delay ?? 0;
    d.s0 = s0;
    d.s1 = s1;
    d.spin = opts.spin ?? 0;
    d.fadeIn = opts.fadeIn ?? 0.15;
    d.vy = opts.vy ?? 0;
    d.mesh.scale.setScalar(s0);
    d.mat.opacity = 0;
    d.mesh.visible = d.delay <= 0;
  }

  update(dt: number): void {
    for (const d of this.items) {
      if (d.life <= 0) continue;
      if (d.delay > 0) {
        d.delay -= dt;
        if (d.delay > 0) continue;
        d.mesh.visible = true;
      }
      d.life -= dt;
      if (d.life <= 0) {
        d.mesh.visible = false;
        continue;
      }
      const t = 1 - d.life / d.max;
      const e = 1 - Math.pow(1 - t, 3);
      d.mesh.scale.setScalar(d.s0 + (d.s1 - d.s0) * e);
      d.mesh.position.y += d.vy * dt;
      if (d.spin) {
        if (d.mesh.rotation.x !== 0) d.mesh.rotation.z += d.spin * dt;
        else d.mesh.rotation.z += d.spin * dt;
      }
      d.mat.opacity = t < d.fadeIn ? t / d.fadeIn : 1 - Math.pow((t - d.fadeIn) / (1 - d.fadeIn), 2);
    }
  }
}

// ======================================================================== big sprites
interface Big {
  s: Sprite;
  m: SpriteMaterial;
  life: number;
  max: number;
  delay: number;
  w: number;
  h: number;
  grow: number;
  vy: number;
  r0: number;
  r1: number;
  rT: number;
  fadeIn: number;
  fadeOut: number;
  y0: number;
  rise: number;
  riseT: number;
}

/**
 * A few large camera-facing pictures with their own texture: the retro sun, the clock face and its hands. A hand turns
 * from `r0` to `r1` over `rT` s (eased) — about its middle, which is the clock's axis.
 */
export class BigSpritePool {
  private items: Big[] = [];
  private next = 0;
  constructor(group: Group, n: number) {
    for (let i = 0; i < n; i++) {
      const m = new SpriteMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: AdditiveBlending });
      const s = new Sprite(m);
      s.visible = false;
      s.renderOrder = 6;
      group.add(s);
      this.items.push({ s, m, life: 0, max: 1, delay: 0, w: 1, h: 1, grow: 0, vy: 0, r0: 0, r1: 0, rT: 1, fadeIn: 0.15, fadeOut: 0.3, y0: 0, rise: 0, riseT: 1 });
    }
  }

  spawn(
    tex: Texture,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    color: Color | number,
    intensity: number,
    life: number,
    opts: { delay?: number; vy?: number; grow?: number; r0?: number; r1?: number; rT?: number; fadeIn?: number; fadeOut?: number; additive?: boolean; rise?: number; riseT?: number } = {},
  ): void {
    const it = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    it.m.map = tex;
    it.m.blending = opts.additive === false ? NormalBlending : AdditiveBlending;
    it.m.needsUpdate = true;
    (typeof color === 'number' ? it.m.color.setHex(color) : it.m.color.copy(color)).multiplyScalar(intensity);
    it.s.position.set(x, y, z);
    it.w = w;
    it.h = h;
    it.life = life;
    it.max = life;
    it.delay = opts.delay ?? 0;
    it.vy = opts.vy ?? 0;
    it.grow = opts.grow ?? 0;
    it.r0 = opts.r0 ?? 0;
    it.r1 = opts.r1 ?? it.r0;
    it.rT = opts.rT ?? 1;
    it.fadeIn = opts.fadeIn ?? 0.15;
    it.fadeOut = opts.fadeOut ?? 0.3;
    it.y0 = y;
    it.rise = opts.rise ?? 0;
    it.riseT = opts.riseT ?? 1;
    it.m.rotation = it.r0;
    it.m.opacity = 0;
    it.s.scale.set(w, h, 1);
    it.s.visible = it.delay <= 0;
  }

  update(dt: number): void {
    for (const it of this.items) {
      if (it.life <= 0) continue;
      if (it.delay > 0) {
        it.delay -= dt;
        if (it.delay > 0) continue;
        it.s.visible = true;
      }
      it.life -= dt;
      if (it.life <= 0) {
        it.s.visible = false;
        continue;
      }
      const age = it.max - it.life;
      const t = age / it.max;
      // a steady drift, or an eased rise to a height (the sun coming up and stopping there)
      if (it.rise) it.s.position.y = it.y0 + it.rise * (1 - Math.pow(1 - Math.min(1, age / it.riseT), 3));
      else it.s.position.y += it.vy * dt;
      const g = 1 + it.grow * t;
      it.s.scale.set(it.w * g, it.h * g, 1);
      const k = Math.min(1, age / it.rT);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      it.m.rotation = it.r0 + (it.r1 - it.r0) * e;
      it.m.opacity = t < it.fadeIn ? t / it.fadeIn : t > 1 - it.fadeOut ? (1 - t) / it.fadeOut : 1;
    }
  }
}

// ============================================================================ the kit
/** All of the cosmetic effects' pieces (one per VFX). */
export class FxKit {
  /** Glitch tears (wide thin bars) and the broken signal's pixels — additive. */
  readonly bars: SpriteBatch;
  readonly pixels: SpriteBatch;
  /** Twinkles: sugar sparkles, flashbulbs, crackle — additive stars. */
  readonly stars: SpriteBatch;
  /** Snowflakes (MIDNIGHT CONFETTI). */
  readonly snow: SpriteBatch;
  /** Bats (PUMPKIN VICTORY) — dark silhouettes, normal blending. */
  readonly bats: SpriteBatch;
  /** Jack-o'-lanterns (PUMPKIN VICTORY). */
  readonly lanterns: SpriteBatch;
  /** Soft glows that move (ghost lights, wisps, motes in a beam). */
  readonly motes: SpriteBatch;
  readonly paper: PaperPool;
  readonly ribbons: RibbonPool;
  readonly beams: BeamPool;
  readonly decals: DecalPool;
  readonly bigs: BigSpritePool;
  private t = 0;

  constructor(group: Group) {
    this.bars = new SpriteBatch(group, 48, barTexture(), true);
    this.pixels = new SpriteBatch(group, 48, pixelTexture(), true);
    this.stars = new SpriteBatch(group, 64, starTexture(), true);
    this.snow = new SpriteBatch(group, 48, snowflakeTexture(), true);
    this.bats = new SpriteBatch(group, 24, batSpriteTexture(), false);
    this.lanterns = new SpriteBatch(group, 16, pumpkinSpriteTexture(), false);
    this.motes = new SpriteBatch(group, 64, glowTexture(), true);
    this.paper = new PaperPool(group, 260);
    this.ribbons = new RibbonPool(group, 18);
    this.beams = new BeamPool(group, 5);
    this.decals = new DecalPool(group, 10);
    this.bigs = new BigSpritePool(group, 14);
    // (the ring texture is warmed with the decals' first use of it: make sure it exists now)
    ringTexture();
  }

  update(dt: number, cam: PerspectiveCamera): void {
    this.t += dt;
    this.bars.update(dt);
    this.pixels.update(dt);
    this.stars.update(dt);
    this.snow.update(dt);
    this.bats.update(dt);
    this.lanterns.update(dt);
    this.motes.update(dt);
    this.paper.setCamera(cam.position);
    this.paper.update(dt);
    this.ribbons.update(dt, this.t);
    this.beams.update(dt);
    this.decals.update(dt);
    this.bigs.update(dt);
  }

  /** Pieces drawn now (the probes: an idle kit draws nothing). */
  drawCalls(): number {
    let n = 0;
    for (const b of [this.bars, this.pixels, this.stars, this.snow, this.bats, this.lanterns, this.motes]) if (b.mesh.visible) n++;
    if (this.paper.mesh.visible) n++;
    if (this.ribbons.mesh.visible) n++;
    return n;
  }
}
