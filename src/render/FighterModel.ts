import {
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type MeshToonMaterial,
  Object3D,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  type Material,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LOOKS, type BodyType, type LookDef } from '../config/looks';
import { makeHoloMaterial, makeToonMaterial, makeUnlitVC, outlineMaterial } from './materials';

type V3 = [number, number, number];
interface PartOpts {
  p?: V3;
  r?: V3;
  s?: V3;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();
const _c = new Color();

/** Collects primitives with baked transforms + vertex colours, merged into one geometry. */
class PartSet {
  private geos: BufferGeometry[] = [];

  add(geo: BufferGeometry, color: number, o: PartOpts = {}, intensity = 1): void {
    const r = o.r ?? [0, 0, 0];
    const p = o.p ?? [0, 0, 0];
    const s = o.s ?? [1, 1, 1];
    _e.set(r[0], r[1], r[2]);
    _q.setFromEuler(_e);
    _m.compose(_p.set(p[0], p[1], p[2]), _q, _s.set(s[0], s[1], s[2]));
    geo.applyMatrix4(_m);
    if (geo.getAttribute('uv')) geo.deleteAttribute('uv');
    const n = geo.getAttribute('position').count;
    if (!geo.index) {
      // Some primitives (RoundedBox) are non-indexed: give them a trivial index so all merge.
      const idx = new (n > 65535 ? Uint32Array : Uint16Array)(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      geo.setIndex(new BufferAttribute(idx, 1));
    }
    const arr = new Float32Array(n * 3);
    _c.set(color).multiplyScalar(intensity);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = _c.r;
      arr[i * 3 + 1] = _c.g;
      arr[i * 3 + 2] = _c.b;
    }
    geo.setAttribute('color', new Float32BufferAttribute(arr, 3));
    this.geos.push(geo);
  }

  build(): BufferGeometry | null {
    if (!this.geos.length) return null;
    const merged = mergeGeometries(this.geos, false);
    for (const g of this.geos) g.dispose();
    this.geos = [];
    if (!merged) return null;
    merged.computeBoundingSphere();
    return merged;
  }
}

// ------------------------------------------------------------ primitives
const sph = (r: number, w = 18, h = 14) => new SphereGeometry(r, w, h);
const cap = (r: number, len: number, rs = 14) => new CapsuleGeometry(r, len, 5, rs, 1);
const rbox = (w: number, h: number, d: number, rad?: number) =>
  new RoundedBoxGeometry(w, h, d, 3, rad ?? Math.min(w, h, d) * 0.3);
const cyl = (rt: number, rb: number, h: number, seg = 18) => new CylinderGeometry(rt, rb, h, seg, 1);
const tor = (R: number, tube: number, arc = Math.PI * 2, ts = 26) => new TorusGeometry(R, tube, 8, ts, arc);
const cone = (r: number, h: number, seg = 10) => new ConeGeometry(r, h, seg, 1);

function shade(color: number, k: number): number {
  _c.set(color);
  const hsl = { h: 0, s: 0, l: 0 };
  _c.getHSL(hsl);
  _c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l * k)));
  return _c.getHex();
}

// ------------------------------------------------------------ dimensions
export interface Dims {
  hipY: number;
  hipW: number;
  thigh: number;
  shin: number;
  legR: number;
  pelvisW: number;
  pelvisH: number;
  pelvisD: number;
  spineY: number;
  torsoH: number;
  profile: [number, number][];
  depth: number;
  shoulderX: number;
  shoulderY: number;
  upperArm: number;
  foreArm: number;
  armR: number;
  handR: number;
  neckY: number;
  neckR: number;
  headR: number;
  shoeL: number;
  shoeW: number;
}

export const DIMS: Record<BodyType, Dims> = {
  lean: {
    hipY: 0.66,
    hipW: 0.14,
    thigh: 0.3,
    shin: 0.32,
    legR: 0.105,
    pelvisW: 0.48,
    pelvisH: 0.26,
    pelvisD: 0.34,
    spineY: 0.06,
    torsoH: 0.62,
    profile: [
      [0.27, 0],
      [0.29, 0.06],
      [0.31, 0.2],
      [0.35, 0.36],
      [0.36, 0.46],
      [0.32, 0.55],
      [0.2, 0.62],
      [0.001, 0.645],
    ],
    depth: 0.78,
    shoulderX: 0.38,
    shoulderY: 0.49,
    upperArm: 0.27,
    foreArm: 0.25,
    armR: 0.1,
    handR: 0.15,
    neckY: 0.6,
    neckR: 0.1,
    headR: 0.46,
    shoeL: 0.46,
    shoeW: 0.26,
  },
  heavy: {
    hipY: 0.62,
    hipW: 0.19,
    thigh: 0.28,
    shin: 0.3,
    legR: 0.14,
    pelvisW: 0.68,
    pelvisH: 0.3,
    pelvisD: 0.46,
    spineY: 0.06,
    torsoH: 0.68,
    profile: [
      [0.39, 0],
      [0.43, 0.06],
      [0.47, 0.2],
      [0.53, 0.38],
      [0.54, 0.5],
      [0.48, 0.6],
      [0.3, 0.68],
      [0.001, 0.71],
    ],
    depth: 0.8,
    shoulderX: 0.57,
    shoulderY: 0.53,
    upperArm: 0.29,
    foreArm: 0.27,
    armR: 0.14,
    handR: 0.2,
    neckY: 0.66,
    neckR: 0.16,
    headR: 0.43,
    shoeL: 0.52,
    shoeW: 0.31,
  },
  slim: {
    hipY: 0.68,
    hipW: 0.13,
    thigh: 0.31,
    shin: 0.33,
    legR: 0.095,
    pelvisW: 0.44,
    pelvisH: 0.25,
    pelvisD: 0.32,
    spineY: 0.06,
    torsoH: 0.56,
    profile: [
      [0.25, 0],
      [0.27, 0.06],
      [0.28, 0.2],
      [0.31, 0.34],
      [0.32, 0.44],
      [0.29, 0.52],
      [0.18, 0.58],
      [0.001, 0.6],
    ],
    depth: 0.76,
    shoulderX: 0.34,
    shoulderY: 0.45,
    upperArm: 0.26,
    foreArm: 0.24,
    armR: 0.088,
    handR: 0.14,
    neckY: 0.56,
    neckR: 0.09,
    headR: 0.46,
    shoeL: 0.43,
    shoeW: 0.25,
  },
  // Alpha 1.3.1 boss: taller than "lean", broad V-shaped chest and shoulders
  athletic: {
    hipY: 0.7,
    hipW: 0.16,
    thigh: 0.32,
    shin: 0.34,
    legR: 0.115,
    pelvisW: 0.52,
    pelvisH: 0.27,
    pelvisD: 0.37,
    spineY: 0.06,
    torsoH: 0.68,
    profile: [
      [0.29, 0],
      [0.3, 0.06],
      [0.33, 0.2],
      [0.4, 0.38],
      [0.42, 0.5],
      [0.37, 0.6],
      [0.23, 0.68],
      [0.001, 0.705],
    ],
    depth: 0.76,
    shoulderX: 0.45,
    shoulderY: 0.54,
    upperArm: 0.29,
    foreArm: 0.27,
    armR: 0.112,
    handR: 0.16,
    neckY: 0.66,
    neckR: 0.112,
    headR: 0.44,
    shoeL: 0.5,
    shoeW: 0.28,
  },
};

function torsoR(d: Dims, y: number): number {
  const p = d.profile;
  if (y <= p[0][1]) return p[0][0];
  for (let i = 1; i < p.length; i++) {
    if (y <= p[i][1]) {
      const t = (y - p[i - 1][1]) / (p[i][1] - p[i - 1][1]);
      return p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t;
    }
  }
  return p[p.length - 1][0];
}

/** Lathe slice of the torso profile between y0..y1, inflated by `off`. */
function torsoShell(d: Dims, y0: number, y1: number, off: number, phiStart = 0, phiLength = Math.PI * 2, closeTop = false): BufferGeometry {
  const pts: Vector2[] = [];
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const y = y0 + ((y1 - y0) * i) / steps;
    pts.push(new Vector2(torsoR(d, y) + off, y));
  }
  if (closeTop) pts.push(new Vector2(0.001, y1 + 0.02));
  const g = new LatheGeometry(pts, 26, phiStart, phiLength);
  g.scale(1, 1, d.depth);
  return g;
}

/** Horizontal ring hugging the torso at height y. */
function torsoRing(d: Dims, y: number, off: number, tube: number): BufferGeometry {
  const g = tor(torsoR(d, y) + off, tube, Math.PI * 2, 30);
  g.rotateX(Math.PI / 2);
  g.scale(1, 1, d.depth);
  g.translate(0, y, 0);
  return g;
}

// ------------------------------------------------------------ geometry set
export type BoneName =
  | 'pelvis'
  | 'torso'
  | 'head'
  | 'upperArmL'
  | 'foreArmL'
  | 'upperArmR'
  | 'foreArmR'
  | 'thighL'
  | 'shinL'
  | 'thighR'
  | 'shinR'
  | 'weaponR'
  | 'weaponL';

interface BoneGeo {
  toon: BufferGeometry | null;
  glow: BufferGeometry | null;
}

export interface RigGeometry {
  look: LookDef;
  dims: Dims;
  bones: Record<BoneName, BoneGeo>;
  eyes: BufferGeometry;
  koEyes: BufferGeometry;
  brows: BufferGeometry;
  mouth: BufferGeometry;
  mouthOpen: BufferGeometry;
  eyePivot: V3;
  mouthPivot: V3;
  headCenterY: number;
  /** Muzzle points in weapon space per weapon bone. */
  muzzleR: V3 | null;
  muzzleL: V3 | null;
  weaponHand: V3;
}

const geoCache = new Map<string, RigGeometry>();

class Bones {
  private map = new Map<BoneName, { toon: PartSet; glow: PartSet }>();
  get(n: BoneName) {
    let b = this.map.get(n);
    if (!b) {
      b = { toon: new PartSet(), glow: new PartSet() };
      this.map.set(n, b);
    }
    return b;
  }
  t(n: BoneName) {
    return this.get(n).toon;
  }
  g(n: BoneName) {
    return this.get(n).glow;
  }
  build(): Record<BoneName, BoneGeo> {
    const names: BoneName[] = [
      'pelvis',
      'torso',
      'head',
      'upperArmL',
      'foreArmL',
      'upperArmR',
      'foreArmR',
      'thighL',
      'shinL',
      'thighR',
      'shinR',
      'weaponR',
      'weaponL',
    ];
    const out = {} as Record<BoneName, BoneGeo>;
    for (const n of names) {
      const b = this.map.get(n);
      out[n] = { toon: b ? b.toon.build() : null, glow: b ? b.glow.build() : null };
    }
    return out;
  }
}

const GLOW = 3.4;

export function getRigGeometry(lookId: string): RigGeometry {
  const cached = geoCache.get(lookId);
  if (cached) return cached;
  const look = LOOKS[lookId];
  const d = DIMS[look.body];
  const B = new Bones();
  const skin = look.skin;
  const skinDark = shade(skin, 0.86);

  // ---------------------------------------------------------------- pelvis
  {
    const P = B.t('pelvis');
    const pm = look.pants.main;
    P.add(rbox(d.pelvisW, d.pelvisH, d.pelvisD, 0.11), pm, { p: [0, -0.03, 0] });
    // waistband
    const wb = tor(d.pelvisW * 0.47, 0.04, Math.PI * 2, 28);
    wb.rotateX(Math.PI / 2);
    wb.scale(1, 1, (d.pelvisD / d.pelvisW) * 1.05);
    P.add(wb, shade(pm, 0.6), { p: [0, d.pelvisH * 0.42, 0] });
    if (look.top.style === 'vest' || look.top.style === 'puffer' || look.top.style === 'pads') {
      P.add(rbox(0.12, 0.08, 0.04, 0.015), 0xffc23a, { p: [0, d.pelvisH * 0.42, d.pelvisD * 0.52] });
    }
    if (look.top.style === 'coat') {
      // showman coat tails: two flared flaps behind the hips with a gold hem
      const tm = look.top.main;
      for (const ss of [1, -1]) {
        const at = { p: [ss * 0.12, -0.2, -d.pelvisD * 0.52] as V3, r: [0.3, ss * 0.12, ss * 0.1] as V3 };
        P.add(rbox(0.2, 0.46, 0.035, 0.015), tm, at);
        P.add(rbox(0.205, 0.035, 0.04, 0.012), look.top.trim, { p: [at.p[0] + ss * 0.022, -0.42, -d.pelvisD * 0.52 - 0.07], r: at.r });
      }
      // side skirt panels so the coat reads as long from the side
      for (const ss of [1, -1]) {
        P.add(rbox(0.035, 0.34, 0.26, 0.014), tm, { p: [ss * (d.pelvisW * 0.52), -0.12, -0.03], r: [0.12, 0, ss * 0.08] });
      }
    }
  }

  // ----------------------------------------------------------------- legs
  for (const side of ['L', 'R'] as const) {
    const s = side === 'L' ? 1 : -1;
    const T = B.t(side === 'L' ? 'thighL' : 'thighR');
    const S = B.t(side === 'L' ? 'shinL' : 'shinR');
    const SG = B.g(side === 'L' ? 'shinL' : 'shinR');
    const pm = look.pants.main;
    const pa = look.pants.accent;
    const style = look.pants.style;
    const tr = d.legR * (style === 'cargo' ? 1.32 : style === 'track' ? 1.18 : 1.06);
    const sr = d.legR * (style === 'cargo' ? 1.18 : style === 'track' ? 1.08 : 0.96);
    T.add(cap(tr, d.thigh * 0.85), pm, { p: [0, -d.thigh * 0.5, 0] });
    S.add(cap(sr, d.shin * 0.62), pm, { p: [0, -d.shin * 0.45, 0] });
    if (style === 'track') {
      for (const off of [-0.03, 0.03]) {
        T.add(rbox(0.024, d.thigh * 0.95, 0.03, 0.01), pa, { p: [s * (tr - 0.006), -d.thigh * 0.5, off] });
        S.add(rbox(0.024, d.shin * 0.8, 0.03, 0.01), pa, { p: [s * (sr - 0.006), -d.shin * 0.45, off] });
      }
    } else if (style === 'cargo') {
      T.add(rbox(0.08, 0.16, 0.2, 0.03), shade(pm, 0.8), { p: [s * (tr + 0.005), -d.thigh * 0.6, 0.0] });
      T.add(rbox(0.09, 0.045, 0.21, 0.015), pa, { p: [s * (tr + 0.012), -d.thigh * 0.6 + 0.08, 0.0] });
      // bunched cuff over the boot
      const cuff = tor(sr * 1.02, 0.045);
      cuff.rotateX(Math.PI / 2);
      S.add(cuff, shade(pm, 0.85), { p: [0, -d.shin + 0.27, 0] });
    } else {
      const cuff = tor(sr * 0.98, 0.034);
      cuff.rotateX(Math.PI / 2);
      S.add(cuff, pa, { p: [0, -d.shin + 0.24, 0] });
      const strap = tor(tr * 1.01, 0.022);
      strap.rotateX(Math.PI / 2);
      T.add(strap, pa, { p: [0, -d.thigh * 0.55, 0] });
      // little glow tab on joggers
      SG.add(rbox(0.02, 0.06, 0.03, 0.008), look.glow, { p: [s * sr * 0.95, -d.shin * 0.4, 0] }, GLOW * 0.7);
    }
    // knee pad hint for heavy fighters
    if (look.body === 'heavy') {
      S.add(sph(sr * 0.9, 12, 10), shade(pm, 0.75), { p: [0, -0.02, sr * 0.45], s: [1, 0.9, 0.7] });
    }

    // ---------------- shoes (built at ankle = ground)
    const g = -d.shin;
    const sw = d.shoeW;
    const sl = d.shoeL;
    const sm = look.shoes.main;
    const sa = look.shoes.accent;
    const so = look.shoes.sole;
    const boots = !!look.shoes.boots;
    S.add(rbox(sw, 0.1, sl, 0.045), so, { p: [0, g + 0.05, 0.07] });
    S.add(rbox(sw + 0.012, 0.035, sl + 0.012, 0.017), boots ? shade(so, 1.6) : sa, { p: [0, g + 0.105, 0.07] });
    const upH = boots ? 0.27 : 0.17;
    S.add(rbox(sw * 0.9, upH, sl * 0.78, 0.07), sm, { p: [0, g + 0.11 + upH / 2, 0.02] });
    S.add(sph(sw * 0.46, 14, 10), sm, { p: [0, g + 0.15, sl * 0.33], s: [1, 0.62, 1.08] });
    // toe cap
    S.add(sph(sw * 0.42, 12, 8), boots ? shade(sm, 0.75) : sa, { p: [0, g + 0.13, sl * 0.42], s: [1, 0.48, 0.8] });
    // laces
    for (let i = 0; i < 3; i++) {
      S.add(rbox(sw * 0.62, 0.022, 0.035, 0.01), boots ? sa : 0xffffff, {
        p: [0, g + 0.23 + (boots ? 0.06 : 0) - i * 0.022, 0.06 + i * 0.06],
        r: [0.45, 0, 0],
      });
    }
    // side swoosh
    for (const ss of [1, -1]) {
      S.add(rbox(0.012, 0.045, sl * 0.5, 0.01), sa, { p: [ss * sw * 0.455, g + 0.17, 0.02], r: [-0.25, 0, 0] });
    }
    // heel tab
    S.add(rbox(sw * 0.4, 0.09, 0.05, 0.02), sa, { p: [0, g + 0.24 + (boots ? 0.08 : 0), -sl * 0.36] });
    // collar
    const col = tor(sr * 1.05, 0.04);
    col.rotateX(Math.PI / 2);
    S.add(col, shade(sm, 0.7), { p: [0, g + 0.11 + upH, 0.0] });
  }

  // ---------------------------------------------------------------- torso
  {
    const T = B.t('torso');
    const TG = B.g('torso');
    const top = look.top;
    const h = d.torsoH;
    switch (top.style) {
      case 'bomber': {
        T.add(torsoShell(d, 0, h, 0, 0, Math.PI * 2, true), top.main);
        T.add(torsoShell(d, h * 0.68, h * 0.9, 0.012), top.accent);
        T.add(torsoRing(d, 0.03, 0.01, 0.05), top.trim);
        T.add(torsoRing(d, h * 0.62, 0.016, 0.016), top.accent);
        // zipper
        T.add(rbox(0.026, h * 0.78, 0.03, 0.01), 0xd9dde8, { p: [0, h * 0.44, torsoR(d, h * 0.44) * d.depth + 0.004] });
        // chest patch
        T.add(sph(0.06, 12, 8), top.accent, { p: [0.15, h * 0.62, torsoR(d, h * 0.62) * d.depth - 0.01], s: [1, 1, 0.35] });
        TG.add(sph(0.025, 8, 6), look.glow, { p: [0.15, h * 0.62, torsoR(d, h * 0.62) * d.depth + 0.012] }, GLOW);
        break;
      }
      case 'windbreaker': {
        T.add(torsoShell(d, 0, h, 0, 0, Math.PI * 2, true), top.main);
        T.add(torsoShell(d, h * 0.38, h * 0.62, 0.012), top.accent);
        T.add(torsoRing(d, 0.03, 0.01, 0.05), top.trim);
        T.add(rbox(0.03, h * 0.8, 0.03, 0.01), top.trim, { p: [0, h * 0.44, torsoR(d, h * 0.44) * d.depth + 0.004] });
        // hood
        const hood = tor(0.2, 0.08, Math.PI, 18);
        hood.rotateX(-Math.PI / 2);
        hood.rotateY(Math.PI);
        T.add(hood, top.main, { p: [0, h * 0.92, -0.06], s: [1.15, 1, 1] });
        break;
      }
      case 'vest': {
        T.add(torsoShell(d, 0, h, 0, 0, Math.PI * 2, true), top.inner);
        const gap = 0.75;
        // red front panels + black back
        T.add(torsoShell(d, 0.04, h * 0.88, 0.03, gap / 2, Math.PI * 0.62 - gap / 2), top.main);
        T.add(torsoShell(d, 0.04, h * 0.88, 0.03, Math.PI * 1.38, Math.PI * 0.62 - gap / 2), top.main);
        T.add(torsoShell(d, 0.04, h * 0.88, 0.032, Math.PI * 0.62, Math.PI * 0.76), top.accent);
        // white piping along the opening
        for (const ss of [1, -1]) {
          const a = (gap / 2) * ss;
          const r = torsoR(d, h * 0.45) + 0.035;
          T.add(cap(0.018, h * 0.7, 6), top.trim, { p: [Math.sin(a) * r, h * 0.46, Math.cos(a) * r * d.depth] });
          // pockets
          T.add(rbox(0.13, 0.11, 0.05, 0.025), shade(top.main, 0.75), {
            p: [Math.sin(0.62 * ss) * (r + 0.01), h * 0.22, Math.cos(0.62 * ss) * (r + 0.01) * d.depth],
            r: [0, 0.62 * ss, 0],
          });
        }
        // collar
        T.add(torsoRing(d, h * 0.9, 0.015, 0.05), top.main);
        break;
      }
      case 'puffer': {
        T.add(torsoShell(d, 0, h, 0, 0, Math.PI * 2, true), top.inner);
        for (let i = 0; i < 4; i++) {
          const y = 0.08 + i * (h * 0.24);
          T.add(torsoRing(d, y, 0.04, 0.085), i % 2 ? top.main : shade(top.main, 0.9));
        }
        T.add(torsoRing(d, h * 0.9, 0.02, 0.07), top.trim);
        T.add(rbox(0.03, h * 0.82, 0.04, 0.012), top.accent, { p: [0, h * 0.44, torsoR(d, h * 0.44) * d.depth + 0.07] });
        break;
      }
      case 'tech': {
        T.add(torsoShell(d, 0, h, 0, 0, Math.PI * 2, true), top.inner);
        const gap = 0.32;
        T.add(torsoShell(d, h * 0.3, h * 0.92, 0.022, gap / 2, Math.PI * 2 - gap), top.main);
        TG.add(torsoRing(d, h * 0.3, 0.026, 0.014), top.accent, {}, GLOW);
        // asymmetric chest panel
        T.add(rbox(0.16, 0.14, 0.04, 0.02), top.accent, {
          p: [-0.12, h * 0.66, torsoR(d, h * 0.66) * d.depth + 0.01],
          r: [0, -0.35, 0.2],
        });
        // high collar
        const col = cyl(0.2, 0.22, 0.14, 20);
        T.add(col, top.trim, { p: [0, h * 0.95, 0.0], s: [1, 1, 0.9] });
        TG.add(torsoRing(d, h * 0.86, 0.03, 0.01), top.accent, {}, GLOW);
        // belt straps
        T.add(torsoRing(d, h * 0.14, 0.02, 0.025), top.trim);
        break;
      }
      case 'racer': {
        // cropped racing jacket: twin stripes, open high collar, glowing star badge
        T.add(torsoShell(d, 0, h, 0, 0, Math.PI * 2, true), top.main);
        T.add(torsoShell(d, 0, h * 0.14, 0.008), top.inner);
        T.add(torsoRing(d, h * 0.15, 0.014, 0.03), top.trim);
        for (const ss of [1, -1]) {
          const z = torsoR(d, h * 0.5) * d.depth;
          T.add(rbox(0.05, h * 0.66, 0.03, 0.012), top.accent, { p: [ss * 0.11, h * 0.52, z - 0.004], r: [0, ss * 0.3, 0] });
          T.add(rbox(0.016, h * 0.66, 0.03, 0.006), top.trim, { p: [ss * 0.155, h * 0.52, z - 0.018], r: [0, ss * 0.42, 0] });
        }
        T.add(rbox(0.022, h * 0.7, 0.026, 0.008), 0xd9dde8, { p: [0, h * 0.5, torsoR(d, h * 0.5) * d.depth + 0.004] });
        const collar = tor(0.19, 0.045, Math.PI * 1.6, 22);
        collar.rotateX(Math.PI / 2);
        collar.rotateY(Math.PI * 1.3);
        T.add(collar, top.trim, { p: [0, h * 0.94, 0], s: [1, 1.6, 0.92] });
        TG.add(rbox(0.05, 0.05, 0.012, 0.006), look.glow, { p: [-0.12, h * 0.68, torsoR(d, h * 0.68) * d.depth + 0.006], r: [0, -0.3, Math.PI / 4] }, GLOW);
        break;
      }
      case 'coat': {
        // long showman coat: gold lapels over a crimson shirt, double row of gold buttons, high collar
        const zf = (y: number) => torsoR(d, y) * d.depth;
        T.add(torsoShell(d, 0, h, 0, 0, Math.PI * 2, true), top.main);
        T.add(rbox(0.17, h * 0.34, 0.03, 0.02), top.inner, { p: [0, h * 0.75, zf(h * 0.75) - 0.004] });
        for (const ss of [1, -1]) {
          T.add(rbox(0.075, h * 0.52, 0.03, 0.012), top.accent, { p: [ss * 0.105, h * 0.66, zf(h * 0.66) + 0.002], r: [0, ss * 0.3, -ss * 0.36] });
          T.add(rbox(0.018, h * 0.52, 0.03, 0.006), top.trim, { p: [ss * 0.145, h * 0.67, zf(h * 0.67) - 0.006], r: [0, ss * 0.42, -ss * 0.36] });
          for (let i = 0; i < 3; i++) {
            const y = h * (0.12 + i * 0.12);
            T.add(sph(0.024, 10, 8), top.trim, { p: [ss * 0.08, y, zf(y) + 0.006] });
          }
        }
        T.add(torsoRing(d, 0.03, 0.012, 0.035), top.trim);
        const collar = tor(0.205, 0.05, Math.PI * 1.5, 22);
        collar.rotateX(Math.PI / 2);
        collar.rotateY(Math.PI * 1.25);
        T.add(collar, top.trim, { p: [0, h * 0.95, -0.01], s: [1, 1.7, 0.95] });
        TG.add(rbox(0.05, 0.05, 0.012, 0.006), top.trim, { p: [-0.15, h * 0.6, zf(h * 0.6) + 0.01], r: [0, -0.35, Math.PI / 4] }, GLOW);
        break;
      }
      case 'track': {
        // Alpha 1.5 (Kai): cropped early-2000s track jacket — navy body, turquoise colour-block
        // yoke, copper piping down the sides, a zip, a popped collar and a glowing trick-shot badge
        const zf = (y: number) => torsoR(d, y) * d.depth;
        T.add(torsoShell(d, 0, h, 0, 0, Math.PI * 2, true), top.main);
        T.add(torsoShell(d, h * 0.58, h * 0.84, 0.012), top.accent);
        T.add(torsoRing(d, h * 0.58, 0.016, 0.014), top.trim);
        T.add(torsoRing(d, 0.04, 0.012, 0.05), top.accent);
        // white tee showing under the cropped hem
        T.add(torsoShell(d, -0.02, 0.05, -0.01), top.inner);
        for (const ss of [1, -1]) {
          // copper piping down each side
          const a = ss * 1.45;
          const r = torsoR(d, h * 0.4) + 0.012;
          T.add(rbox(0.026, h * 0.62, 0.03, 0.01), top.trim, { p: [Math.sin(a) * r, h * 0.36, Math.cos(a) * r * d.depth], r: [0, a, 0] });
        }
        T.add(rbox(0.024, h * 0.8, 0.03, 0.01), 0xd9dde8, { p: [0, h * 0.44, zf(h * 0.44) + 0.004] });
        // popped collar: a tall open band
        const col = tor(0.2, 0.05, Math.PI * 1.55, 22);
        col.rotateX(Math.PI / 2);
        col.rotateY(Math.PI * 1.27);
        T.add(col, top.main, { p: [0, h * 0.96, -0.01], s: [1, 2.1, 0.94] });
        T.add(col.clone(), top.accent, { p: [0, h * 0.96 + 0.06, -0.01], s: [1.02, 0.5, 0.96] });
        // round badge with a bounce-arrow glow
        T.add(sph(0.062, 14, 10), top.trim, { p: [0.16, h * 0.68, zf(h * 0.68) - 0.012], s: [1, 1, 0.35] });
        TG.add(tor(0.034, 0.008, Math.PI * 1.3, 12), look.glow, { p: [0.16, h * 0.68, zf(h * 0.68) + 0.01], r: [0, 0, 0.6] }, GLOW);
        break;
      }
      case 'moto': {
        // Alpha 1.5 (Rina): cropped cream moto jacket — coral side panels, an asymmetric zip,
        // wide notched lapels over a graphite top and a belted waist with a silver buckle
        const zf = (y: number) => torsoR(d, y) * d.depth;
        T.add(torsoShell(d, 0, h, 0, 0, Math.PI * 2, true), top.inner);
        T.add(torsoShell(d, h * 0.08, h * 0.95, 0.02, 0.4, Math.PI * 2 - 0.8), top.main);
        for (const ss of [1, -1]) {
          T.add(torsoShell(d, h * 0.1, h * 0.62, 0.026, ss > 0 ? Math.PI * 0.32 : Math.PI * 1.43, Math.PI * 0.25), top.accent);
          // lapels folded open
          T.add(rbox(0.09, h * 0.36, 0.028, 0.014), top.main, { p: [ss * 0.115, h * 0.72, zf(h * 0.72) + 0.01], r: [0, ss * 0.32, -ss * 0.45] });
          T.add(rbox(0.016, h * 0.34, 0.03, 0.006), top.accent, { p: [ss * 0.16, h * 0.72, zf(h * 0.72) + 0.002], r: [0, ss * 0.42, -ss * 0.45] });
        }
        // asymmetric zip: from the left hip up to the right collarbone
        const zl = h * 0.78;
        const zip = rbox(0.022, zl, 0.026, 0.008);
        zip.rotateZ(0.38);
        T.add(zip, 0xc9ced8, { p: [0.04, h * 0.46, zf(h * 0.46) + 0.022] });
        // belt
        T.add(torsoRing(d, h * 0.12, 0.03, 0.03), top.trim);
        T.add(rbox(0.08, 0.06, 0.03, 0.012), 0xd9dde8, { p: [-0.12, h * 0.12, zf(h * 0.12) + 0.04], r: [0, -0.35, 0] });
        // shoulder straps (epaulettes)
        for (const ss of [1, -1]) T.add(rbox(0.06, 0.03, 0.2, 0.012), top.trim, { p: [ss * d.shoulderX * 0.82, d.shoulderY + 0.06, 0], r: [0, 0, -ss * 0.25] });
        break;
      }
      case 'pads': {
        // sleeveless jersey with a hazard-stripe badge (shoulder pads below)
        T.add(torsoShell(d, 0, h, 0, 0, Math.PI * 2, true), top.main);
        T.add(torsoRing(d, 0.03, 0.012, 0.05), top.accent);
        T.add(torsoRing(d, h * 0.56, 0.014, 0.034), top.accent);
        T.add(torsoRing(d, h * 0.49, 0.014, 0.014), top.trim);
        const z = torsoR(d, h * 0.28) * d.depth;
        T.add(rbox(0.24, 0.18, 0.03, 0.03), top.accent, { p: [0, h * 0.28, z] });
        for (const dx of [-0.05, 0.05]) T.add(rbox(0.035, 0.17, 0.03, 0.01), top.trim, { p: [dx, h * 0.28, z + 0.01], r: [0, 0, 0.55] });
        for (const ss of [1, -1]) {
          T.add(rbox(0.05, 0.22, 0.03, 0.014), top.accent, { p: [ss * 0.08, h * 0.82, torsoR(d, h * 0.82) * d.depth + 0.004], r: [0, 0, ss * 0.5] });
        }
        break;
      }
    }
    // neck
    T.add(cyl(d.neckR, d.neckR * 1.1, 0.16, 14), skinDark, { p: [0, d.neckY - 0.02, 0] });

    // shoulder pads for tech / puffer
    if (top.style === 'tech') {
      for (const ss of [1, -1]) {
        T.add(sph(d.armR * 1.6, 12, 10), top.accent, { p: [ss * d.shoulderX, d.shoulderY + 0.05, 0], s: [1.1, 0.6, 1] });
      }
    }
    // big armoured pads: the jersey's signature silhouette
    if (top.style === 'pads') {
      for (const ss of [1, -1]) {
        const at = { p: [ss * d.shoulderX * 0.94, d.shoulderY + 0.1, 0] as V3, r: [0, 0, -ss * 0.32] as V3 };
        T.add(sph(0.25, 16, 12), top.accent, { ...at, s: [1.15, 0.6, 1.05] });
        const rim = tor(0.235, 0.03, Math.PI * 2, 24);
        rim.rotateX(Math.PI / 2);
        T.add(rim, top.trim, { p: [at.p[0], at.p[1] - 0.04, 0], r: at.r, s: [1.15, 1, 1.05] });
        T.add(sph(0.2, 14, 10), shade(top.accent, 0.62), { p: [at.p[0], at.p[1] - 0.07, 0], r: at.r, s: [1.1, 0.42, 1.0] });
      }
    }

    // gold epaulettes with fringe: the champion's coat silhouette
    if (top.style === 'coat') {
      for (const ss of [1, -1]) {
        const ex = ss * d.shoulderX * 0.96;
        const ey = d.shoulderY + 0.07;
        T.add(sph(0.16, 14, 10), top.accent, { p: [ex, ey, 0], s: [1.25, 0.42, 1.08], r: [0, 0, -ss * 0.22] });
        const rim = tor(0.16, 0.022, Math.PI * 2, 20);
        rim.rotateX(Math.PI / 2);
        T.add(rim, top.trim, { p: [ex, ey - 0.02, 0], r: [0, 0, -ss * 0.22], s: [1.25, 1, 1.08] });
        for (let i = -2; i <= 2; i++) T.add(rbox(0.02, 0.075, 0.02, 0.008), top.trim, { p: [ex + ss * 0.19, ey - 0.08, i * 0.055], r: [0, 0, -ss * 0.22] });
      }
    }
    // championship belt worn over the coat
    if (look.accessories.includes('belt')) {
      T.add(torsoRing(d, 0.06, 0.02, 0.05), 0x2a1d10);
      const bz = torsoR(d, 0.06) * d.depth + 0.04;
      T.add(sph(0.13, 20, 14), 0xffc23a, { p: [0, 0.07, bz], s: [1.45, 0.95, 0.28] });
      T.add(sph(0.1, 18, 12), 0xffe9a0, { p: [0, 0.07, bz + 0.02], s: [1.3, 0.8, 0.22] });
      TG.add(sph(0.045, 12, 10), 0xff3a4a, { p: [0, 0.07, bz + 0.045], s: [1, 1, 0.45] }, GLOW * 0.8);
      for (const ss of [1, -1]) T.add(rbox(0.08, 0.075, 0.03, 0.015), 0xd8a23a, { p: [ss * 0.24, 0.065, torsoR(d, 0.06) * d.depth * 0.86], r: [0, ss * 0.7, 0] });
    }

    // accessories on torso
    if (look.accessories.includes('headphones')) {
      const band = tor(0.25, 0.035, Math.PI * 1.1, 20);
      band.rotateX(Math.PI / 2);
      band.rotateY(-Math.PI * 0.05);
      const dark = look.id === 'dex' ? 0x15151a : 0xf2f4fa;
      T.add(band, dark, { p: [0, d.neckY - 0.02, 0.0], r: [-0.25, 0, 0] });
      for (const ss of [1, -1]) {
        const cup = cyl(0.1, 0.1, 0.07, 18);
        cup.rotateZ(Math.PI / 2);
        T.add(cup, dark, { p: [ss * 0.24, d.neckY - 0.04, 0.06], r: [0, 0, 0] });
        T.add(sph(0.07, 12, 8), look.top.accent, { p: [ss * 0.28, d.neckY - 0.04, 0.06], s: [0.5, 1, 1] });
      }
    }
    if (look.accessories.includes('choker')) {
      // Alpha 1.5 (Rina): graphite choker with a small glowing coral stone
      const ch = tor(d.neckR * 1.18, 0.022, Math.PI * 2, 24);
      ch.rotateX(Math.PI / 2);
      T.add(ch, look.top.trim, { p: [0, d.neckY - 0.03, 0.005] });
      TG.add(sph(0.026, 10, 8), look.glow, { p: [0, d.neckY - 0.045, d.neckR * 1.2], s: [1, 1.2, 0.6] }, GLOW);
    }
    if (look.accessories.includes('chain')) {
      const ch = tor(0.2, 0.026, Math.PI * 2, 30);
      T.add(ch, 0xffc23a, { p: [0, d.neckY - 0.08, 0.13], r: [1.15, 0, 0], s: [1.25, 1, 1] });
      T.add(rbox(0.09, 0.11, 0.03, 0.02), 0xffd76a, { p: [0, d.neckY - 0.25, torsoR(d, d.neckY - 0.25) * d.depth + 0.05] });
    }
  }

  // ----------------------------------------------------------------- arms
  const sleeveMain = look.top.style === 'vest' || look.top.style === 'puffer' || look.top.style === 'pads' ? skin : look.top.main;
  for (const side of ['L', 'R'] as const) {
    const s = side === 'L' ? 1 : -1;
    const U = B.t(side === 'L' ? 'upperArmL' : 'upperArmR');
    const F = B.t(side === 'L' ? 'foreArmL' : 'foreArmR');
    const FG = B.g(side === 'L' ? 'foreArmL' : 'foreArmR');
    const ar = d.armR;
    const top = look.top;
    const bare = sleeveMain === skin;
    U.add(sph(ar * (bare ? 1.35 : 1.45), 14, 10), bare ? (top.style === 'puffer' ? top.inner : top.inner) : top.main, { p: [0, -0.02, 0] });
    U.add(cap(ar * (bare ? 1.1 : 1.22), d.upperArm * 0.6), sleeveMain, { p: [0, -d.upperArm * 0.5, 0] });
    if (bare) {
      // tee sleeve + bicep
      U.add(cap(ar * 1.32, 0.04), top.inner, { p: [0, -0.07, 0] });
      U.add(sph(ar * 0.95, 12, 10), skin, { p: [0, -d.upperArm * 0.5, ar * 0.45], s: [1, 1.2, 0.9] });
    } else if (top.style === 'bomber') {
      for (const yy of [0.42, 0.55]) {
        const ring = tor(ar * 1.24, 0.014);
        ring.rotateX(Math.PI / 2);
        U.add(ring, top.accent, { p: [0, -d.upperArm * yy, 0] });
      }
      if (side === 'L') U.add(rbox(0.05, 0.1, 0.12, 0.02), top.accent, { p: [s * ar * 1.2, -d.upperArm * 0.35, 0] });
    } else if (top.style === 'windbreaker') {
      const ring = tor(ar * 1.24, 0.03);
      ring.rotateX(Math.PI / 2);
      U.add(ring, top.accent, { p: [0, -d.upperArm * 0.5, 0] });
    } else if (top.style === 'racer') {
      // racing stripe down the outside of the sleeve
      U.add(rbox(0.032, d.upperArm * 0.8, 0.04, 0.012), top.accent, { p: [s * ar * 1.18, -d.upperArm * 0.5, 0] });
    } else if (top.style === 'coat') {
      const ring = tor(ar * 1.25, 0.016);
      ring.rotateX(Math.PI / 2);
      U.add(ring, top.accent, { p: [0, -d.upperArm * 0.62, 0] });
    } else if (top.style === 'track') {
      // two track stripes down the outside of the sleeve and a turquoise shoulder block
      U.add(sph(ar * 1.5, 14, 10), top.accent, { p: [0, 0.0, 0], s: [1, 0.75, 1] });
      for (const [off, c] of [
        [0.022, top.accent],
        [-0.022, top.trim],
      ] as [number, number][]) U.add(rbox(0.02, d.upperArm * 0.8, 0.026, 0.008), c, { p: [s * ar * 1.2, -d.upperArm * 0.5, off] });
    } else if (top.style === 'moto') {
      // a coral band above the elbow
      const ring = tor(ar * 1.24, 0.026);
      ring.rotateX(Math.PI / 2);
      U.add(ring, top.accent, { p: [0, -d.upperArm * 0.7, 0] });
    }
    // forearm
    F.add(cap(ar * (bare ? 1.05 : 1.12), d.foreArm * 0.55), sleeveMain, { p: [0, -d.foreArm * 0.45, 0] });
    if (top.style === 'racer') F.add(rbox(0.03, d.foreArm * 0.62, 0.038, 0.012), top.accent, { p: [s * ar * 1.12, -d.foreArm * 0.42, 0] });
    if (top.style === 'track') {
      for (const [off, c] of [
        [0.02, top.accent],
        [-0.02, top.trim],
      ] as [number, number][]) F.add(rbox(0.018, d.foreArm * 0.6, 0.024, 0.008), c, { p: [s * ar * 1.1, -d.foreArm * 0.42, off] });
    }
    if (top.style === 'moto') {
      // zipped cuff
      F.add(rbox(0.016, d.foreArm * 0.28, 0.02, 0.006), 0xc9ced8, { p: [s * ar * 1.08, -d.foreArm * 0.72, 0] });
    }
    if (top.style === 'coat') {
      // wide turned-back gold cuff
      F.add(cyl(ar * 1.32, ar * 1.22, 0.1, 16), top.accent, { p: [0, -d.foreArm * 0.78, 0] });
    }
    if (!bare) {
      const cuff = tor(ar * 1.1, 0.035);
      cuff.rotateX(Math.PI / 2);
      if (top.style === 'tech') FG.add(cuff, top.accent, { p: [0, -d.foreArm * 0.85, 0] }, GLOW);
      else F.add(cuff, top.trim, { p: [0, -d.foreArm * 0.85, 0] });
    }
    if (look.accessories.includes('wristbands')) {
      const wb = cyl(ar * 1.12, ar * 1.12, 0.07, 16);
      F.add(wb, look.top.style === 'vest' ? look.top.main : look.top.accent, { p: [0, -d.foreArm * 0.88, 0] });
    }
    // hand
    const hr = d.handR;
    const hy = -d.foreArm - hr * 0.55;
    F.add(sph(hr, 16, 12), look.gloves, { p: [0, hy, 0], s: [1, 1.02, 0.92] });
    F.add(rbox(hr * 1.55, hr * 0.85, hr * 1.25, hr * 0.35), look.fingerless ? skin : shade(look.gloves, 1.2), {
      p: [0, hy - hr * 0.72, hr * 0.12],
    });
    F.add(sph(hr * 0.42, 10, 8), look.fingerless ? skin : look.gloves, { p: [-s * hr * 0.75, hy - hr * 0.2, hr * 0.45] });
    // knuckle strap
    F.add(rbox(hr * 1.6, hr * 0.28, hr * 1.1, hr * 0.12), shade(look.gloves, 0.7), { p: [0, hy - hr * 0.3, hr * 0.05] });
  }

  // ----------------------------------------------------------------- head
  const R = d.headR;
  const cy = R * 0.84;
  // Alpha 1.5.5: face traits may make the face a touch longer and narrower (a little older)
  const jawK = look.face?.jaw ?? 0;
  const fx = 1 - 0.035 * jawK;
  const fy = 1 + 0.035 * jawK;
  const hx = R * fx;
  const hy = R * 0.94 * fy;
  const hz = R * 0.92;
  const faceZ = (x: number, y: number) => hz * Math.sqrt(Math.max(0, 1 - (x / hx) ** 2 - (y / hy) ** 2));
  {
    const H = B.t('head');
    const HG = B.g('head');
    H.add(sph(R, 30, 22), skin, { p: [0, cy, 0.02], s: [fx, 0.94 * fy, 0.92] });
    if (look.body === 'heavy') {
      // square jaw
      H.add(sph(R * 0.82, 20, 14), skin, { p: [0, cy - R * 0.3, -0.02], s: [1.14, 0.72, 0.9] });
    }
    const face = look.face;
    if (face && face.jaw > 0) {
      // Alpha 1.5.5: a slightly squarer jaw behind the face plane (it shapes the silhouette, no crease
      // across the cheeks) and a small rounded chin at the bottom of the longer face
      H.add(sph(R * 0.78, 22, 14), skin, { p: [0, cy - R * 0.36, -0.07], s: [0.93, 0.56, 0.8] });
      H.add(sph(0.075, 14, 10), skin, { p: [0, cy - hy * 0.74, faceZ(0, -hy * 0.74) - 0.06], s: [1.35, 0.7, 0.8] });
    }
    if (face && face.cheekbones > 0) {
      // soft cheekbones: a warm highlight high on each cheek, a gentle shadow crease under it
      const c = face.cheekbones;
      for (const s of [1, -1]) {
        const x = s * 0.24;
        H.add(sph(0.09, 14, 10), shade(skin, 1.1), { p: [x, cy - 0.07, faceZ(x, -0.07) - 0.045], s: [1.35, 0.6 * c, 0.55], r: [0, s * 0.6, -s * 0.22] });
        H.add(sph(0.08, 12, 8), shade(skin, 0.84), { p: [x * 0.95, cy - 0.13, faceZ(x * 0.95, -0.13) - 0.04], s: [1.25, 0.32 * c, 0.45], r: [0, s * 0.6, -s * 0.3] });
      }
    }
    // ears
    for (const s of [1, -1]) {
      H.add(sph(0.09, 12, 10), skin, { p: [s * R * 0.97, cy - 0.02, 0.0], s: [0.55, 1, 0.78] });
      H.add(sph(0.05, 10, 8), skinDark, { p: [s * R * 1.0, cy - 0.02, 0.02], s: [0.4, 0.8, 0.6] });
    }
    // nose
    H.add(sph(0.055, 12, 10), shade(skin, 0.93), { p: [0, cy - 0.07, faceZ(0, -0.07) + 0.0], s: [1, 0.85, 0.9] });
    if (look.accessories.includes('blush')) {
      for (const s of [1, -1]) {
        const x = s * 0.22;
        H.add(sph(0.06, 10, 8), 0xff9fb8, { p: [x, cy - 0.11, faceZ(x, -0.11) - 0.012], s: [1.2, 0.6, 0.3], r: [0, s * 0.45, 0] });
      }
    }
    if (look.accessories.includes('stubble')) {
      const st = new SphereGeometry(R * 1.006, 24, 12, 0, Math.PI, 2.12, 0.75);
      H.add(st, shade(skin, 0.68), { p: [0, cy, 0.02], s: [1, 0.94, 0.92] });
    }
    if (look.accessories.includes('beard')) {
      const bc = look.hair.color2;
      const bd = new SphereGeometry(R * 1.04, 24, 14, 0, Math.PI, 1.65, 1.3);
      H.add(bd, bc, { p: [0, cy + 0.02, 0.03], s: [1.02, 0.98, 0.96] });
      H.add(rbox(0.22, 0.06, 0.06, 0.03), bc, { p: [0, cy - 0.135, faceZ(0, -0.14) + 0.01], r: [0, 0, 0] });
    }

    // hair
    const hc = look.hair.color;
    const h2 = look.hair.color2;
    switch (look.hair.style) {
      case 'spiky': {
        H.add(new SphereGeometry(R * 1.05, 26, 14, 0, Math.PI * 2, 0, 1.2), hc, { p: [0, cy + 0.01, -0.02], r: [-0.28, 0, 0] });
        H.add(new SphereGeometry(R * 1.03, 22, 12, Math.PI, Math.PI, 0.5, 1.35), hc, { p: [0, cy, 0.0] });
        const spikes: { p: V3; r: V3; s: number; c: number }[] = [
          { p: [0.0, cy + R * 0.85, R * 0.45], r: [0.9, 0, 0], s: 1.15, c: h2 },
          { p: [0.18, cy + R * 0.8, R * 0.36], r: [0.8, 0, -0.45], s: 1.0, c: hc },
          { p: [-0.18, cy + R * 0.8, R * 0.36], r: [0.8, 0, 0.45], s: 1.0, c: hc },
          { p: [0.08, cy + R * 0.98, 0.0], r: [-0.5, 0, -0.2], s: 1.1, c: hc },
          { p: [-0.12, cy + R * 0.95, -0.04], r: [-0.6, 0, 0.35], s: 1.05, c: hc },
          { p: [0.0, cy + R * 0.75, -R * 0.55], r: [-1.25, 0, 0], s: 1.0, c: hc },
          { p: [0.28, cy + R * 0.6, -R * 0.3], r: [-0.9, 0, -0.8], s: 0.85, c: hc },
          { p: [-0.28, cy + R * 0.6, -R * 0.3], r: [-0.9, 0, 0.8], s: 0.85, c: hc },
        ];
        for (const sp of spikes) {
          H.add(cone(0.12 * sp.s, 0.34 * sp.s, 10), sp.c, { p: sp.p, r: sp.r });
        }
        // sideburns
        for (const s of [1, -1]) H.add(rbox(0.05, 0.14, 0.08, 0.02), hc, { p: [s * R * 0.9, cy + 0.02, 0.1] });
        break;
      }
      case 'buzz': {
        H.add(new SphereGeometry(R * 1.025, 26, 12, 0, Math.PI * 2, 0, 1.15), hc, { p: [0, cy + 0.01, -0.02], r: [-0.2, 0, 0] });
        H.add(new SphereGeometry(R * 1.02, 22, 12, Math.PI, Math.PI, 0.6, 1.2), hc, { p: [0, cy, 0.01] });
        H.add(rbox(R * 1.3, 0.13, R * 1.3, 0.06), hc, { p: [0, cy + R * 0.88, -0.03] });
        break;
      }
      case 'buns': {
        H.add(new SphereGeometry(R * 1.05, 26, 14, 0, Math.PI * 2, 0, 1.3), hc, { p: [0, cy + 0.01, -0.03], r: [-0.22, 0, 0] });
        H.add(new SphereGeometry(R * 1.04, 22, 12, Math.PI, Math.PI, 0.5, 1.6), hc, { p: [0, cy, 0.0] });
        for (const s of [1, -1]) {
          H.add(sph(0.18, 16, 12), hc, { p: [s * 0.27, cy + R * 0.82, -0.06] });
          H.add(sph(0.12, 14, 10), h2, { p: [s * 0.31, cy + R * 0.98, -0.07] });
          const tie = tor(0.13, 0.03);
          H.add(tie, h2, { p: [s * 0.25, cy + R * 0.72, -0.05], r: [Math.PI / 2 - 0.4, 0, s * 0.5] });
          // side locks
          H.add(cap(0.065, 0.28, 10), hc, { p: [s * R * 0.86, cy - 0.12, 0.12], r: [0.15, 0, s * 0.1] });
          H.add(sph(0.075, 10, 8), h2, { p: [s * R * 0.88, cy - 0.34, 0.15] });
        }
        // sweeping bangs
        H.add(sph(0.2, 16, 12), hc, { p: [0.1, cy + R * 0.58, R * 0.6], s: [1.45, 0.5, 0.62], r: [0.3, 0, -0.35] });
        H.add(sph(0.12, 12, 10), h2, { p: [-0.18, cy + R * 0.5, R * 0.7], s: [1.2, 0.45, 0.55], r: [0.4, 0, 0.5] });
        break;
      }
      case 'cap': {
        H.add(new SphereGeometry(R * 1.08, 26, 14, 0, Math.PI * 2, 0, 1.32), hc, { p: [0, cy + 0.02, -0.01], r: [-0.12, 0, 0] });
        // backwards brim
        H.add(rbox(0.42, 0.035, 0.3, 0.015), h2, { p: [0, cy + R * 0.42, -R * 1.02], r: [-0.25, 0, 0] });
        // strap window at forehead
        H.add(rbox(0.16, 0.06, 0.04, 0.015), h2, { p: [0, cy + R * 0.48, R * 0.86], r: [-0.45, 0, 0] });
        H.add(sph(0.05, 8, 6), hc, { p: [0, cy + R * 1.06, -0.02] });
        // hair under the cap
        for (const s of [1, -1]) H.add(rbox(0.05, 0.12, 0.08, 0.02), h2, { p: [s * R * 0.92, cy + 0.04, 0.1] });
        break;
      }
      case 'beanie': {
        H.add(new SphereGeometry(R * 1.08, 26, 14, 0, Math.PI * 2, 0, 1.45), hc, { p: [0, cy + 0.04, -0.01], s: [1, 1.12, 1], r: [-0.08, 0, 0] });
        const rim = tor(R * 1.04, 0.075, Math.PI * 2, 32);
        rim.rotateX(Math.PI / 2);
        H.add(rim, shade(hc, 0.8), { p: [0, cy + R * 0.28, 0.0], r: [-0.08, 0, 0] });
        H.add(rbox(0.12, 0.08, 0.03, 0.015), look.top.accent, { p: [0.2, cy + R * 0.3, R * 1.0], r: [0, 0.4, 0] });
        break;
      }
      case 'ponytail': {
        H.add(new SphereGeometry(R * 1.05, 26, 14, 0, Math.PI * 2, 0, 1.28), hc, { p: [0, cy + 0.01, -0.03], r: [-0.22, 0, 0] });
        H.add(new SphereGeometry(R * 1.04, 22, 12, Math.PI, Math.PI, 0.5, 1.55), hc, { p: [0, cy, 0.0] });
        // side-swept bang
        H.add(sph(0.22, 16, 12), hc, { p: [0.08, cy + R * 0.6, R * 0.6], s: [1.6, 0.5, 0.62], r: [0.35, 0, -0.42] });
        H.add(sph(0.13, 12, 10), shade(hc, 0.9), { p: [-0.24, cy + R * 0.4, R * 0.7], s: [1.0, 0.46, 0.5], r: [0.4, 0, 0.62] });
        // face-framing lock
        H.add(cap(0.06, 0.3, 10), hc, { p: [R * 0.86, cy - 0.12, 0.16], r: [0.12, 0, 0.12] });
        H.add(sph(0.065, 10, 8), hc, { p: [R * 0.88, cy - 0.35, 0.18] });
        // high ponytail sweeping back and down
        const tie = tor(0.095, 0.032, Math.PI * 2, 16);
        H.add(tie, h2, { p: [0, cy + R * 0.86, -R * 0.66], r: [-0.65, 0, 0] });
        H.add(sph(0.16, 14, 10), hc, { p: [0, cy + R * 0.82, -R * 0.98], s: [0.85, 1.3, 0.85], r: [-0.95, 0, 0] });
        H.add(sph(0.135, 14, 10), hc, { p: [0, cy + R * 0.46, -R * 1.24], s: [0.85, 1.45, 0.85], r: [-0.4, 0, 0] });
        H.add(sph(0.115, 12, 10), hc, { p: [0, cy + R * 0.04, -R * 1.33], s: [0.8, 1.5, 0.8], r: [-0.15, 0, 0] });
        // icy-dyed end of the ponytail
        H.add(sph(0.1, 12, 10), h2, { p: [0, cy - R * 0.36, -R * 1.29], s: [0.75, 1.35, 0.75] });
        break;
      }
      case 'quiff': {
        // shaved sides + a tall pompadour rolling forward over the hairline
        H.add(new SphereGeometry(R * 1.012, 26, 14, 0, Math.PI * 2, 0, 1.1), h2, { p: [0, cy, -0.02], r: [-0.34, 0, 0] });
        H.add(new SphereGeometry(R * 1.01, 22, 12, Math.PI, Math.PI, 0.55, 1.2), h2, { p: [0, cy, 0.0] });
        H.add(sph(0.3, 18, 12), hc, { p: [0, cy + R * 0.9, R * 0.1], s: [0.92, 0.6, 1.15], r: [0.25, 0, 0] });
        H.add(sph(0.26, 18, 12), hc, { p: [0, cy + R * 1.1, R * 0.55], s: [0.88, 0.8, 1.0], r: [0.75, 0, 0] });
        H.add(sph(0.18, 14, 10), shade(hc, 1.12), { p: [0, cy + R * 1.3, R * 0.8], s: [0.8, 0.7, 1.1], r: [1.1, 0, 0] });
        H.add(sph(0.12, 12, 10), shade(hc, 1.3), { p: [-0.13, cy + R * 1.08, R * 0.45], s: [0.45, 0.55, 1.4], r: [0.7, 0, 0.25] });
        for (const s of [1, -1]) H.add(rbox(0.05, 0.1, 0.07, 0.02), h2, { p: [s * R * 0.92, cy + 0.02, 0.1] });
        break;
      }
      case 'slick': {
        // slicked-back champion hair: smooth cap swept to the back, volume on top, a gold streak
        H.add(new SphereGeometry(R * 1.045, 26, 14, 0, Math.PI * 2, 0, 1.25), hc, { p: [0, cy + 0.01, -0.04], r: [-0.42, 0, 0] });
        H.add(new SphereGeometry(R * 1.035, 22, 12, Math.PI, Math.PI, 0.45, 1.68), hc, { p: [0, cy, -0.01] });
        H.add(sph(0.26, 18, 12), hc, { p: [0, cy + R * 0.86, R * 0.32], s: [1.15, 0.52, 1.1], r: [0.35, 0, 0] });
        H.add(sph(0.23, 16, 12), shade(hc, 1.25), { p: [0, cy + R * 0.97, -R * 0.06], s: [1.05, 0.5, 1.3], r: [-0.12, 0, 0] });
        // the gold streak sweeping back from the front roll
        H.add(sph(0.11, 12, 10), h2, { p: [0.12, cy + R * 1.0, R * 0.12], s: [0.62, 0.42, 2.3], r: [0.2, 0.12, 0] });
        // tapered nape
        H.add(sph(0.22, 14, 10), hc, { p: [0, cy - R * 0.1, -R * 0.78], s: [1.45, 0.95, 0.72] });
        for (const s of [1, -1]) H.add(rbox(0.05, 0.13, 0.07, 0.02), hc, { p: [s * R * 0.93, cy - 0.01, 0.08] });
        break;
      }
      case 'curtain': {
        // Alpha 1.5 (Kai): late-90s curtains — a middle part, two swept lobes over the temples
        // with copper frosted tips, volume on top, short tapered sides
        H.add(new SphereGeometry(R * 1.05, 26, 14, 0, Math.PI * 2, 0, 1.22), hc, { p: [0, cy + 0.01, -0.03], r: [-0.26, 0, 0] });
        H.add(new SphereGeometry(R * 1.035, 22, 12, Math.PI, Math.PI, 0.5, 1.4), hc, { p: [0, cy, 0.0] });
        H.add(sph(0.25, 18, 12), hc, { p: [0, cy + R * 0.9, R * 0.12], s: [1.25, 0.55, 1.05] });
        for (const s of [1, -1]) {
          // each curtain: a lock from the part sweeping out and down to the temple, frosted at the end
          H.add(sph(0.2, 16, 12), shade(hc, 1.18), { p: [s * 0.12, cy + R * 0.64, R * 0.74], s: [1.0, 0.42, 0.6], r: [0.75, s * 0.15, -s * 0.55] });
          H.add(sph(0.17, 14, 10), hc, { p: [s * 0.26, cy + R * 0.42, R * 0.76], s: [0.88, 0.42, 0.55], r: [0.6, s * 0.45, -s * 1.0] });
          H.add(sph(0.08, 12, 8), h2, { p: [s * 0.33, cy + R * 0.29, R * 0.74], s: [0.78, 0.42, 0.55], r: [0.6, s * 0.5, -s * 1.15] });
          H.add(rbox(0.05, 0.12, 0.08, 0.02), hc, { p: [s * R * 0.92, cy + 0.0, 0.1] });
        }
        // the part line
        H.add(rbox(0.018, 0.04, R * 0.5, 0.008), shade(hc, 0.6), { p: [0, cy + R * 0.98, R * 0.28], r: [0.55, 0, 0] });
        break;
      }
      case 'bob': {
        // Alpha 1.5 (Rina): sharp asymmetric bob — jaw-length sides that flip at the ends, a long
        // swept fringe with a coral streak, an angled short nape
        H.add(new SphereGeometry(R * 1.06, 26, 14, 0, Math.PI * 2, 0, 1.34), hc, { p: [0, cy + 0.01, -0.03], r: [-0.18, 0, 0] });
        H.add(new SphereGeometry(R * 1.055, 22, 14, Math.PI, Math.PI, 0.4, 1.78), hc, { p: [0, cy, 0.0] });
        for (const s of [1, -1]) {
          H.add(sph(0.22, 16, 12), hc, { p: [s * R * 0.88, cy - R * 0.12, 0.04], s: [0.52, 1.25, 1.0] });
          H.add(sph(0.12, 12, 10), hc, { p: [s * R * 0.9, cy - R * 0.5, 0.14], s: [0.6, 0.45, 1.05], r: [0, 0, s * 0.35] });
        }
        H.add(sph(0.24, 18, 12), hc, { p: [0.1, cy + R * 0.52, R * 0.68], s: [1.55, 0.58, 0.55], r: [0.42, 0, -0.5] });
        H.add(sph(0.12, 12, 10), h2, { p: [0.26, cy + R * 0.38, R * 0.76], s: [0.6, 1.15, 0.42], r: [0.3, 0, -0.62] });
        H.add(sph(0.11, 12, 10), hc, { p: [-0.24, cy + R * 0.6, R * 0.62], s: [1.1, 0.5, 0.55], r: [0.5, 0, 0.4] });
        H.add(sph(0.2, 14, 10), hc, { p: [0, cy - R * 0.3, -R * 0.76], s: [1.45, 0.72, 0.72], r: [0.25, 0, 0] });
        break;
      }
      case 'mohawk': {
        H.add(new SphereGeometry(R * 1.02, 26, 14, 0, Math.PI * 2, 0, 1.3), h2, { p: [0, cy + 0.0, -0.02], r: [-0.2, 0, 0] });
        H.add(new SphereGeometry(R * 1.015, 22, 12, Math.PI, Math.PI, 0.5, 1.3), h2, { p: [0, cy, 0.0] });
        for (let i = 0; i < 6; i++) {
          const a = -0.55 + i * 0.36;
          const rr = R * 1.0;
          const y = cy + Math.cos(a) * rr * 0.98;
          const z = Math.sin(-a) * rr + 0.02;
          H.add(sph(0.16 - i * 0.008, 14, 10), hc, { p: [0, y + 0.06, z], s: [0.34, 1.35 - i * 0.07, 1.0], r: [-a - 0.35, 0, 0] });
        }
        break;
      }
    }

    // head accessories
    if (look.accessories.includes('headset')) {
      const band = tor(R * 1.08, 0.025, Math.PI, 24);
      H.add(band, look.top.trim, { p: [0, cy, -0.02], r: [0, 0, 0] });
      const cup = cyl(0.1, 0.1, 0.07, 18);
      cup.rotateZ(Math.PI / 2);
      H.add(cup, look.weaponColor, { p: [R * 1.06, cy - 0.02, 0] });
      H.add(cup.clone(), look.weaponColor, { p: [-R * 2.12, 0, 0] });
      HG.add(tor(0.07, 0.015), look.glow, { p: [R * 1.11, cy - 0.02, 0], r: [0, Math.PI / 2, 0] }, GLOW);
      H.add(cyl(0.012, 0.012, 0.34, 6), look.top.trim, { p: [R * 1.08, cy + 0.2, -0.04], r: [0, 0, -0.2] });
      HG.add(sph(0.04, 10, 8), look.glow, { p: [R * 1.08 + 0.035, cy + 0.38, -0.04] }, GLOW * 1.2);
      // mic
      H.add(cap(0.012, 0.24, 6), look.top.trim, { p: [R * 0.82, cy - 0.2, R * 0.52], r: [0.4, 0.9, 1.3] });
    }
    if (look.accessories.includes('goggles')) {
      const band = tor(R * 1.05, 0.03, Math.PI * 2, 30);
      band.rotateX(Math.PI / 2);
      H.add(band, 0x15181d, { p: [0, cy + R * 0.42, 0.0], r: [-0.3, 0, 0] });
      for (const s of [1, -1]) {
        const x = s * 0.15;
        const z = faceZ(x, R * 0.36) + 0.03;
        const rim = cyl(0.095, 0.095, 0.07, 18);
        rim.rotateX(Math.PI / 2);
        H.add(rim, 0x2a2d33, { p: [x, cy + R * 0.4, z], r: [-0.45, s * 0.3, 0] });
        const lens = cyl(0.075, 0.075, 0.02, 18);
        lens.rotateX(Math.PI / 2);
        HG.add(lens, look.glow, { p: [x, cy + R * 0.4 + 0.02, z + 0.035], r: [-0.45, s * 0.3, 0] }, GLOW * 0.8);
      }
    }
    if (look.accessories.includes('visor')) {
      // sleek wraparound visor pushed up on the forehead: a glowing arc over the hairline
      const arc = 1.7;
      const lens = tor(R * 1.13, 0.036, arc, 24);
      lens.rotateX(Math.PI / 2);
      lens.rotateY(arc / 2 - Math.PI / 2);
      HG.add(lens, look.glow, { p: [0, cy + R * 0.4, -0.02], r: [-0.18, 0, 0], s: [1, 1, 0.95] }, GLOW * 0.9);
      const frame = tor(R * 1.12, 0.02, arc + 0.25, 24);
      frame.rotateX(Math.PI / 2);
      frame.rotateY((arc + 0.25) / 2 - Math.PI / 2);
      H.add(frame, look.top.trim, { p: [0, cy + R * 0.4 + 0.035, -0.04], r: [-0.18, 0, 0], s: [1, 1, 0.95] });
    }
    if (look.accessories.includes('shades')) {
      // Alpha 1.5 (Kai): retro oval shades pushed up into the hair, turquoise-mirrored lenses
      for (const s of [1, -1]) {
        const lens = cyl(0.075, 0.075, 0.025, 16);
        lens.rotateX(Math.PI / 2);
        H.add(lens, 0x14161c, { p: [s * 0.13, cy + R * 0.86, R * 0.5], r: [-1.05, s * 0.12, 0], s: [1.25, 1, 0.8] });
        const glint = cyl(0.058, 0.058, 0.01, 14);
        glint.rotateX(Math.PI / 2);
        HG.add(glint, look.glow, { p: [s * 0.13, cy + R * 0.87 + 0.012, R * 0.5 + 0.012], r: [-1.05, s * 0.12, 0], s: [1.25, 1, 0.8] }, GLOW * 0.6);
      }
      H.add(rbox(0.07, 0.016, 0.016, 0.006), look.top.trim, { p: [0, cy + R * 0.88, R * 0.52], r: [-1.05, 0, 0] });
    }
    if (look.accessories.includes('earring')) {
      H.add(tor(0.035, 0.01), 0xffd76a, { p: [-R * 1.0, cy - 0.12, 0.02], r: [0, Math.PI / 2, 0] });
    }
  }

  // ------------------------------------------------------- face (separate)
  const eyeY = -0.04;
  const eyeX = look.body === 'heavy' ? 0.15 : 0.16;
  const eyePivot: V3 = [0, cy + eyeY, 0];
  const eyes = new PartSet();
  const koEyes = new PartSet();
  for (const s of [1, -1]) {
    const x = s * eyeX;
    const z = faceZ(x, eyeY) - 0.03;
    const yaw = Math.asin(x / R) * 0.85;
    const eh = (look.body === 'heavy' ? 0.92 : 1.08) * (look.face?.eyeHeight ?? 1);
    eyes.add(sph(0.1, 16, 12), 0xffffff, { p: [x, 0, z], s: [0.82, eh, 0.45], r: [0, yaw, 0] });
    eyes.add(sph(0.062, 14, 10), look.eyes, { p: [x * 0.97, -0.004, z + 0.03], s: [0.82, 1.06 * eh, 0.4], r: [0, yaw, 0] });
    eyes.add(sph(0.034, 10, 8), 0x0b0b12, { p: [x * 0.97, -0.006, z + 0.045], s: [0.85, 1.05 * eh, 0.4], r: [0, yaw, 0] });
    eyes.add(sph(0.017, 8, 6), 0xffffff, { p: [x * 0.97 - 0.018, 0.024, z + 0.058], r: [0, yaw, 0] });
    // KO "x" eyes
    koEyes.add(rbox(0.12, 0.025, 0.02, 0.01), 0x101018, { p: [x, 0, z + 0.04], r: [0, yaw, 0.785] });
    koEyes.add(rbox(0.12, 0.025, 0.02, 0.01), 0x101018, { p: [x, 0, z + 0.04], r: [0, yaw, -0.785] });
  }
  const brows = new PartSet();
  const browC =
    look.hair.style === 'cap' || look.hair.style === 'beanie' || look.hair.style === 'mohawk' || look.hair.style === 'quiff'
      ? look.hair.color2
      : look.hair.style === 'ponytail'
        ? shade(look.hair.color, 0.7)
        : look.hair.color;
  for (const s of [1, -1]) {
    if (look.face?.archedBrows) {
      // Alpha 1.5.5: thick arched brows in two strokes, the right one cocked higher
      const lift = s < 0 ? 0.02 : 0;
      const yawI = Math.asin((s * (eyeX - 0.03)) / R) * 0.85;
      const yawO = Math.asin((s * (eyeX + 0.06)) / R) * 0.85;
      const byI = eyeY + 0.112 + lift;
      const byO = eyeY + 0.124 + lift * 0.6;
      brows.add(rbox(0.105, 0.056, 0.045, 0.024), browC, { p: [s * (eyeX - 0.03), cy + byI, faceZ(s * (eyeX - 0.03), byI) + 0.004], r: [0, yawI, s * (s < 0 ? 0.08 : 0.18)] });
      brows.add(rbox(0.095, 0.044, 0.045, 0.019), browC, { p: [s * (eyeX + 0.06), cy + byO, faceZ(s * (eyeX + 0.06), byO) + 0.004], r: [0, yawO, -s * 0.36] });
      continue;
    }
    const x = s * eyeX;
    const by = eyeY + 0.135;
    const z = faceZ(x, by) + 0.0;
    let rz = 0;
    let thick = 0.034;
    if (look.brow === 'stern') {
      rz = s * 0.28;
      thick = 0.05;
    } else if (look.brow === 'cocky') {
      rz = s > 0 ? -0.12 : -0.3;
    } else {
      rz = s * -0.18;
      thick = 0.026;
    }
    const yaw = Math.asin(x / R) * 0.85;
    brows.add(rbox(0.14, thick, 0.04, thick * 0.45), browC, { p: [x, cy + by + (look.brow === 'cocky' && s < 0 ? 0.02 : 0), z], r: [0, yaw, rz] });
  }
  const mouthY = look.body === 'heavy' ? -0.2 : -0.185;
  const grin = !!look.face?.grin;
  const mouthPivot: V3 = [look.mouth === 'smirk' || grin ? 0.04 : 0, cy + mouthY, faceZ(0, mouthY) + 0.012];
  const mouth = new PartSet();
  const mouthOpen = new PartSet();
  const lip = 0x2a1418;
  if (grin) {
    // Alpha 1.5.5: a lopsided showman's grin, wider on one side, with a dimple at the raised corner
    const arc = tor(0.078, 0.016, Math.PI * 0.8, 14);
    arc.rotateZ(Math.PI + Math.PI * 0.1);
    mouth.add(arc, lip, { p: [0, 0.038, 0], r: [0, 0, 0.2] });
    mouth.add(rbox(0.016, 0.05, 0.014, 0.006), shade(skin, 0.72), { p: [0.105, 0.022, -0.012], r: [0, 0.35, -0.3] });
  } else if (look.mouth === 'flat') {
    mouth.add(rbox(0.13, 0.026, 0.03, 0.012), lip, { p: [0, 0, 0] });
  } else {
    const arc = tor(0.07, 0.015, Math.PI * 0.85, 14);
    arc.rotateZ(Math.PI + Math.PI * 0.075);
    mouth.add(arc, lip, { p: [0, 0.035, 0], r: [0, 0, look.mouth === 'smirk' ? 0.25 : 0] });
  }
  mouthOpen.add(sph(0.075, 14, 10), 0x3a1018, { p: [0, -0.01, 0], s: [1.15, 0.85, 0.35] });
  mouthOpen.add(sph(0.045, 10, 8), 0xff6b7d, { p: [0, -0.035, 0.012], s: [1.2, 0.5, 0.3] });
  mouthOpen.add(rbox(0.1, 0.022, 0.02, 0.008), 0xffffff, { p: [0, 0.036, 0.018] });

  // --------------------------------------------------------------- weapons
  let muzzleR: V3 | null = null;
  let muzzleL: V3 | null = null;
  const wc = look.weaponColor;
  const wd = look.weaponDark;
  const gl = look.glow;
  if (look.weapon === 'twin_blasters') {
    for (const bone of ['weaponR', 'weaponL'] as const) {
      const W = B.t(bone);
      const WG = B.g(bone);
      W.add(rbox(0.13, 0.15, 0.34, 0.045), wc, { p: [0, 0.1, 0.12] });
      W.add(rbox(0.1, 0.19, 0.11, 0.03), wd, { p: [0, -0.02, -0.02], r: [-0.25, 0, 0] });
      const barrel = cyl(0.045, 0.052, 0.17, 14);
      barrel.rotateX(Math.PI / 2);
      W.add(barrel, wd, { p: [0, 0.11, 0.35] });
      const mz = tor(0.055, 0.018, Math.PI * 2, 16);
      W.add(mz, wd, { p: [0, 0.11, 0.43] });
      W.add(rbox(0.05, 0.035, 0.24, 0.012), wd, { p: [0, 0.19, 0.12] });
      WG.add(rbox(0.137, 0.045, 0.13, 0.015), gl, { p: [0, 0.075, 0.1] }, GLOW);
      WG.add(sph(0.03, 8, 6), gl, { p: [0, 0.11, 0.44] }, GLOW);
    }
    muzzleR = [0, 0.11, 0.47];
    muzzleL = [0, 0.11, 0.47];
  } else if (look.weapon === 'boom_cannon') {
    const W = B.t('weaponR');
    const WG = B.g('weaponR');
    W.add(rbox(0.3, 0.28, 0.64, 0.09), wc, { p: [0, 0.13, 0.22] });
    const barrel = cyl(0.12, 0.135, 0.26, 20);
    barrel.rotateX(Math.PI / 2);
    W.add(barrel, wd, { p: [0, 0.15, 0.62] });
    const rim = tor(0.13, 0.045, Math.PI * 2, 22);
    W.add(rim, wd, { p: [0, 0.15, 0.75] });
    WG.add(tor(0.085, 0.022, Math.PI * 2, 20), gl, { p: [0, 0.15, 0.77] }, GLOW);
    const drum = cyl(0.15, 0.15, 0.16, 20);
    drum.rotateZ(Math.PI / 2);
    W.add(drum, wd, { p: [0, -0.02, 0.24] });
    for (let i = 0; i < 3; i++) {
      for (const s of [1, -1]) WG.add(rbox(0.012, 0.05, 0.08, 0.01), gl, { p: [s * 0.152, 0.16, 0.06 + i * 0.12] }, GLOW);
    }
    const handle = tor(0.11, 0.025, Math.PI, 14);
    W.add(handle, wd, { p: [0, 0.27, 0.22], r: [0, Math.PI / 2, 0] });
    W.add(rbox(0.1, 0.2, 0.12, 0.03), wd, { p: [0, -0.04, -0.04], r: [-0.2, 0, 0] });
    // stripe
    W.add(rbox(0.305, 0.04, 0.3, 0.015), look.top.style === 'vest' ? look.top.main : look.top.accent, { p: [0, 0.2, 0.3] });
    muzzleR = [0, 0.15, 0.8];
  } else if (look.weapon === 'breaker') {
    // PRIME BREAKER (Alpha 1.3.3, boss only): the champion's heavy burst rifle. Graphite body
    // with gold rails, a stage-spotlight sight on top, a gold "crown" muzzle brake, dark-red
    // details and three glowing burst indicators per side. Weapon space: +Z = barrel,
    // +Y = top, the right hand on the grip at the origin, the left on the fore-grip.
    const W = B.t('weaponR');
    const WG = B.g('weaponR');
    const red = 0x8a1426;
    const black = 0x111116;
    const plate = shade(wd, 1.45);
    // receiver: a broad, angular block
    W.add(rbox(0.17, 0.2, 0.6, 0.05), wd, { p: [0, 0.09, 0.2] });
    W.add(rbox(0.155, 0.05, 0.5, 0.02), plate, { p: [0, 0.2, 0.18] });
    for (const s of [1, -1]) {
      // gold side rails, a dark-red panel and the small PRIME diamond
      W.add(rbox(0.02, 0.035, 0.46, 0.008), wc, { p: [s * 0.088, 0.135, 0.2] });
      W.add(rbox(0.014, 0.06, 0.15, 0.006), red, { p: [s * 0.087, 0.06, 0.37] });
      W.add(rbox(0.008, 0.05, 0.05, 0.004), wc, { p: [s * 0.09, 0.072, 0.25], r: [Math.PI / 4, 0, 0] });
      // burst indicators: three warm dots, one per slug
      for (let i = 0; i < 3; i++) WG.add(sph(0.017, 8, 6), gl, { p: [s * 0.088, 0.072, 0.04 + i * 0.05], s: [0.5, 1, 1] }, GLOW * 1.2);
    }
    // heavy barrel shroud with glowing heat vents and a gold top rib
    W.add(rbox(0.16, 0.16, 0.44, 0.04), wd, { p: [0, 0.1, 0.71] });
    W.add(rbox(0.04, 0.02, 0.4, 0.008), wc, { p: [0, 0.185, 0.71] });
    for (let i = 0; i < 3; i++) {
      for (const sg of [1, -1]) {
        W.add(rbox(0.012, 0.07, 0.05, 0.004), black, { p: [sg * 0.081, 0.1, 0.6 + i * 0.09] });
        WG.add(rbox(0.008, 0.05, 0.032, 0.003), gl, { p: [sg * 0.085, 0.1, 0.6 + i * 0.09] }, GLOW * 0.9);
      }
    }
    W.add(rbox(0.17, 0.035, 0.06, 0.012), wc, { p: [0, 0.1, 0.5] });
    const barrel = cyl(0.045, 0.05, 0.2, 14);
    barrel.rotateX(Math.PI / 2);
    W.add(barrel, wd, { p: [0, 0.1, 1.01] });
    // crown muzzle brake: gold collar, three forward prongs, a dark-red ring, glowing bore
    const collar = cyl(0.078, 0.078, 0.08, 16);
    collar.rotateX(Math.PI / 2);
    W.add(collar, wc, { p: [0, 0.1, 1.11] });
    for (let k = 0; k < 3; k++) {
      const a = Math.PI / 2 + (k - 1) * 1.1;
      W.add(rbox(0.04, 0.036, 0.18, 0.012), wc, { p: [Math.cos(a) * 0.08, 0.1 + Math.sin(a) * 0.08, 1.2], r: [-Math.sin(a) * 0.26, Math.cos(a) * 0.26, 0] });
    }
    W.add(tor(0.074, 0.015, Math.PI * 2, 18), red, { p: [0, 0.1, 1.15] });
    WG.add(tor(0.04, 0.012, Math.PI * 2, 16), gl, { p: [0, 0.1, 1.19] }, GLOW * 1.2);
    WG.add(sph(0.026, 8, 6), gl, { p: [0, 0.1, 1.18] }, GLOW);
    // stage-spotlight sight: a big flared lamp with a gold rim, a bright lens and barn-door flaps
    W.add(rbox(0.07, 0.07, 0.14, 0.015), wd, { p: [0, 0.26, 0.14] });
    const lamp = cyl(0.11, 0.08, 0.3, 20);
    lamp.rotateX(Math.PI / 2);
    W.add(lamp, black, { p: [0, 0.36, 0.13] });
    W.add(tor(0.108, 0.02, Math.PI * 2, 24), wc, { p: [0, 0.36, 0.285] });
    const cap = cyl(0.07, 0.07, 0.04, 14);
    cap.rotateX(Math.PI / 2);
    W.add(cap, wc, { p: [0, 0.36, -0.03] });
    for (const zz of [0.06, 0.13, 0.2]) W.add(rbox(0.016, 0.03, 0.035, 0.005), wd, { p: [0, 0.46, zz] });
    for (const sg of [1, -1]) {
      // barn doors: hinged flaps above and below the lens, opened outward
      W.add(rbox(0.2, 0.012, 0.09, 0.004), wd, { p: [0, 0.36 + sg * 0.115, 0.33], r: [-sg * 0.5, 0, 0] });
      W.add(rbox(0.012, 0.16, 0.08, 0.004), wd, { p: [sg * 0.115, 0.36, 0.33], r: [0, sg * 0.5, 0] });
    }
    WG.add(sph(0.095, 16, 12), gl, { p: [0, 0.36, 0.288], s: [1, 1, 0.28] }, GLOW * 1.5);
    // magazine angled forward, with a dark-red band
    W.add(rbox(0.1, 0.2, 0.13, 0.03), black, { p: [0, -0.07, 0.31], r: [0.25, 0, 0] });
    W.add(rbox(0.104, 0.032, 0.134, 0.01), red, { p: [0, -0.125, 0.325], r: [0.25, 0, 0] });
    // pistol grip, fore-grip for the left hand
    W.add(rbox(0.078, 0.19, 0.088, 0.025), wd, { p: [0, -0.05, 0.0], r: [-0.3, 0, 0] });
    W.add(rbox(0.062, 0.15, 0.072, 0.02), wd, { p: [0, -0.045, 0.56] });
    // skeleton stock with a gold butt plate
    W.add(rbox(0.07, 0.06, 0.3, 0.02), wd, { p: [0, 0.13, -0.24] });
    W.add(rbox(0.06, 0.05, 0.27, 0.02), wd, { p: [0, 0.0, -0.25], r: [-0.22, 0, 0] });
    W.add(rbox(0.09, 0.21, 0.05, 0.02), wc, { p: [0, 0.07, -0.4] });
    muzzleR = [0, 0.1, 1.26];
  } else if (look.weapon === 'ricochet') {
    // Alpha 1.5 — Kai's trick pistol: a long copper barrel over a revolver-style drum, two
    // angled "bank" deflector fins at the muzzle and turquoise glow strips. One-handed.
    const W = B.t('weaponR');
    const WG = B.g('weaponR');
    W.add(rbox(0.12, 0.15, 0.34, 0.04), wd, { p: [0, 0.1, 0.1] });
    const drum = cyl(0.085, 0.085, 0.13, 16);
    drum.rotateX(Math.PI / 2);
    W.add(drum, wc, { p: [0, 0.12, 0.2] });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      WG.add(sph(0.016, 8, 6), gl, { p: [Math.cos(a) * 0.06, 0.12 + Math.sin(a) * 0.06, 0.272] }, GLOW);
    }
    W.add(rbox(0.075, 0.08, 0.44, 0.025), wc, { p: [0, 0.14, 0.5] });
    W.add(rbox(0.04, 0.03, 0.4, 0.01), wd, { p: [0, 0.19, 0.5] });
    for (const sg of [1, -1]) {
      W.add(rbox(0.012, 0.06, 0.12, 0.005), wc, { p: [sg * 0.06, 0.15, 0.66], r: [0, sg * 0.45, 0] });
      WG.add(rbox(0.008, 0.016, 0.34, 0.005), gl, { p: [sg * 0.04, 0.14, 0.5] }, GLOW);
    }
    W.add(tor(0.042, 0.014, Math.PI * 2, 16), wd, { p: [0, 0.14, 0.73] });
    WG.add(tor(0.028, 0.009, Math.PI * 2, 14), gl, { p: [0, 0.14, 0.745] }, GLOW * 1.2);
    W.add(rbox(0.08, 0.2, 0.1, 0.03), wd, { p: [0, -0.04, -0.02], r: [-0.3, 0, 0] });
    W.add(tor(0.05, 0.012, Math.PI, 12), wd, { p: [0, 0.02, 0.07], r: [Math.PI, Math.PI / 2, 0] });
    W.add(rbox(0.03, 0.05, 0.05, 0.01), wc, { p: [0, 0.2, -0.06], r: [0.5, 0, 0] });
    muzzleR = [0, 0.14, 0.77];
  } else if (look.weapon === 'stinger') {
    // Alpha 1.5 — Rina's compact twin-barrel blaster with a wrist brace and coral emitters,
    // held close (one hand on the grip, the other bracing the wrist)
    const W = B.t('weaponR');
    const WG = B.g('weaponR');
    W.add(rbox(0.13, 0.15, 0.3, 0.045), wc, { p: [0, 0.09, 0.1] });
    for (const sg of [1, -1]) {
      const b = cyl(0.028, 0.03, 0.17, 12);
      b.rotateX(Math.PI / 2);
      W.add(b, wd, { p: [sg * 0.036, 0.12, 0.31] });
      WG.add(tor(0.03, 0.009, Math.PI * 2, 14), gl, { p: [sg * 0.036, 0.12, 0.4] }, GLOW * 1.1);
      WG.add(rbox(0.008, 0.03, 0.16, 0.004), gl, { p: [sg * 0.068, 0.07, 0.1] }, GLOW * 0.8);
    }
    W.add(rbox(0.05, 0.035, 0.18, 0.012), wd, { p: [0, 0.18, 0.08] });
    WG.add(rbox(0.026, 0.02, 0.03, 0.006), gl, { p: [0, 0.205, 0.14] }, GLOW);
    W.add(rbox(0.07, 0.17, 0.08, 0.025), wd, { p: [0, -0.05, 0.0], r: [-0.25, 0, 0] });
    const brace = tor(0.08, 0.016, Math.PI, 12);
    W.add(brace, wd, { p: [0, 0.05, -0.12], r: [0, 0, Math.PI / 2] });
    W.add(rbox(0.06, 0.09, 0.05, 0.02), 0xff6f61, { p: [0, 0.06, -0.2] });
    muzzleR = [0, 0.12, 0.42];
  } else if (look.weapon === 'pulse_rifle') {
    // long marksman rifle with a scope (weapon space: barrel +Z), shouldered with both hands
    const W = B.t('weaponR');
    const WG = B.g('weaponR');
    W.add(rbox(0.11, 0.15, 0.56, 0.045), wc, { p: [0, 0.08, 0.16] });
    W.add(rbox(0.085, 0.16, 0.32, 0.04), wd, { p: [0, 0.04, -0.26], r: [0.1, 0, 0] });
    W.add(rbox(0.116, 0.035, 0.22, 0.012), look.top.accent, { p: [0, 0.03, 0.22] });
    W.add(rbox(0.08, 0.085, 0.34, 0.03), wd, { p: [0, 0.09, 0.58] });
    const barrel = cyl(0.026, 0.03, 0.3, 12);
    barrel.rotateX(Math.PI / 2);
    W.add(barrel, wd, { p: [0, 0.09, 0.88] });
    W.add(rbox(0.07, 0.06, 0.08, 0.02), wd, { p: [0, 0.09, 1.02] });
    WG.add(tor(0.034, 0.011, Math.PI * 2, 16), gl, { p: [0, 0.09, 1.07] }, GLOW);
    const scope = cyl(0.045, 0.045, 0.26, 14);
    scope.rotateX(Math.PI / 2);
    W.add(scope, wd, { p: [0, 0.215, 0.14] });
    for (const zz of [0.06, 0.22]) W.add(rbox(0.04, 0.06, 0.035, 0.01), wd, { p: [0, 0.165, zz] });
    WG.add(sph(0.04, 10, 8), gl, { p: [0, 0.215, 0.275], s: [1, 1, 0.35] }, GLOW);
    W.add(rbox(0.07, 0.17, 0.08, 0.025), wd, { p: [0, -0.05, 0.0], r: [-0.3, 0, 0] });
    W.add(rbox(0.06, 0.13, 0.07, 0.02), wd, { p: [0, -0.04, 0.42] });
    for (const s of [1, -1]) WG.add(rbox(0.012, 0.02, 0.4, 0.006), gl, { p: [s * 0.058, 0.1, 0.18] }, GLOW);
    muzzleR = [0, 0.09, 1.08];
  } else {
    // compact tech carbine held in the right hand, supported by the left (weapon space: barrel +Z)
    const W = B.t('weaponR');
    const WG = B.g('weaponR');
    W.add(rbox(0.12, 0.16, 0.5, 0.045), wc, { p: [0, 0.08, 0.12] });
    W.add(rbox(0.09, 0.14, 0.26, 0.04), wd, { p: [0, 0.05, -0.22], r: [0.12, 0, 0] });
    W.add(rbox(0.095, 0.095, 0.3, 0.03), wd, { p: [0, 0.09, 0.48] });
    const tip = cyl(0.032, 0.038, 0.12, 12);
    tip.rotateX(Math.PI / 2);
    W.add(tip, wd, { p: [0, 0.09, 0.67] });
    WG.add(tor(0.042, 0.012, Math.PI * 2, 16), gl, { p: [0, 0.09, 0.73] }, GLOW);
    W.add(rbox(0.075, 0.19, 0.09, 0.025), wd, { p: [0, -0.07, 0.2], r: [0.28, 0, 0] });
    WG.add(rbox(0.078, 0.11, 0.02, 0.008), gl, { p: [0, -0.06, 0.25], r: [0.28, 0, 0] }, GLOW * 0.8);
    W.add(rbox(0.07, 0.15, 0.08, 0.025), wd, { p: [0, -0.04, -0.02], r: [-0.3, 0, 0] });
    W.add(rbox(0.05, 0.12, 0.06, 0.02), wd, { p: [0, -0.03, 0.38] });
    W.add(rbox(0.065, 0.05, 0.09, 0.015), wd, { p: [0, 0.185, 0.08] });
    WG.add(rbox(0.05, 0.034, 0.012, 0.005), gl, { p: [0, 0.205, 0.13] }, GLOW);
    for (const s of [1, -1]) WG.add(rbox(0.012, 0.022, 0.3, 0.008), gl, { p: [s * 0.062, 0.12, 0.12] }, GLOW);
    muzzleR = [0, 0.09, 0.76];
    // tech cuff on the right wrist
    const FG = B.g('foreArmR');
    const cuffRing = tor(d.armR * 1.25, 0.022, Math.PI * 2, 22);
    cuffRing.rotateX(Math.PI / 2);
    FG.add(cuffRing, gl, { p: [0, -d.foreArm * 0.8, 0] }, GLOW);
  }

  const geo: RigGeometry = {
    look,
    dims: d,
    bones: B.build(),
    eyes: eyes.build()!,
    koEyes: koEyes.build()!,
    brows: brows.build()!,
    mouth: mouth.build()!,
    mouthOpen: mouthOpen.build()!,
    eyePivot,
    mouthPivot,
    headCenterY: cy,
    muzzleR,
    muzzleL,
    weaponHand: [0, -d.foreArm - d.handR * 0.5, 0.0],
  };
  // Eye / mouth parts were authored relative to their pivots, so blink and
  // expression scaling happen around the right point.
  geoCache.set(lookId, geo);
  return geo;
}

// ------------------------------------------------------------------ rig
export interface FighterRig {
  look: LookDef;
  dims: Dims;
  holo: boolean;
  root: Group;
  body: Group;
  roll: Group;
  hips: Group;
  spine: Group;
  head: Group;
  shoulderL: Group;
  elbowL: Group;
  shoulderR: Group;
  elbowR: Group;
  legL: Group;
  kneeL: Group;
  legR: Group;
  kneeR: Group;
  weaponR: Group | null;
  weaponL: Group | null;
  /** [primary(right), secondary(left)] */
  muzzles: Object3D[];
  /** Centre of the right hand (fist charge effects). */
  handR: Object3D;
  /** Alpha 1.6.1: centre of the left (free / support) hand — thrown cards leave from here. */
  handL: Object3D;
  eyes: Mesh;
  koEyes: Mesh;
  brows: Mesh;
  mouth: Mesh;
  mouthOpen: Mesh;
  toonMat: MeshToonMaterial | null;
  glowMat: MeshBasicMaterial | ShaderMaterial;
  holoMat: ShaderMaterial | null;
  meshes: Mesh[];
}

function boneGroup(name: string, parent: Object3D, pos: V3): Group {
  const g = new Group();
  g.name = name;
  g.position.set(pos[0], pos[1], pos[2]);
  parent.add(g);
  return g;
}

/** Builds a fighter instance. `holo` produces a hologram decoy sharing geometry. */
export function createFighterRig(lookId: string, holo = false): FighterRig {
  const G = getRigGeometry(lookId);
  const d = G.dims;
  const look = G.look;
  const toonMat = holo ? null : makeToonMaterial(look.rim, 0.5);
  const holoMat = holo ? makeHoloMaterial(look.glow) : null;
  const glowMat: MeshBasicMaterial | ShaderMaterial = holo ? holoMat! : makeUnlitVC(1);
  const eyeMat: Material = holo ? holoMat! : makeUnlitVC(1);
  const outline = outlineMaterial();
  const meshes: Mesh[] = [];

  const attach = (bone: BoneName, parent: Object3D) => {
    const bg = G.bones[bone];
    if (bg.toon) {
      const m = new Mesh(bg.toon, holo ? holoMat! : toonMat!);
      m.castShadow = !holo;
      parent.add(m);
      meshes.push(m);
      if (!holo) {
        const o = new Mesh(bg.toon, outline);
        o.castShadow = false;
        parent.add(o);
      }
    }
    if (bg.glow) {
      const m = new Mesh(bg.glow, glowMat);
      parent.add(m);
    }
  };

  const root = new Group();
  root.name = 'fighter-' + lookId;
  const body = boneGroup('body', root, [0, 0, 0]);
  const roll = boneGroup('roll', body, [0, d.hipY, 0]);
  const hips = boneGroup('hips', roll, [0, 0, 0]);
  attach('pelvis', hips);
  const legL = boneGroup('legL', hips, [d.hipW, -0.04, 0]);
  attach('thighL', legL);
  const kneeL = boneGroup('kneeL', legL, [0, -d.thigh, 0]);
  attach('shinL', kneeL);
  const legR = boneGroup('legR', hips, [-d.hipW, -0.04, 0]);
  attach('thighR', legR);
  const kneeR = boneGroup('kneeR', legR, [0, -d.thigh, 0]);
  attach('shinR', kneeR);

  const spine = boneGroup('spine', hips, [0, d.spineY, 0]);
  attach('torso', spine);
  const head = boneGroup('head', spine, [0, d.neckY, 0]);
  attach('head', head);

  const eyes = new Mesh(G.eyes, eyeMat);
  eyes.position.set(G.eyePivot[0], G.eyePivot[1], G.eyePivot[2]);
  head.add(eyes);
  const koEyes = new Mesh(G.koEyes, eyeMat);
  koEyes.position.copy(eyes.position);
  koEyes.visible = false;
  head.add(koEyes);
  const brows = new Mesh(G.brows, eyeMat);
  head.add(brows);
  const mouth = new Mesh(G.mouth, eyeMat);
  head.add(mouth);
  mouth.position.set(G.mouthPivot[0], G.mouthPivot[1], G.mouthPivot[2]);
  const mouthOpen = new Mesh(G.mouthOpen, eyeMat);
  mouthOpen.position.copy(mouth.position);
  mouthOpen.visible = false;
  head.add(mouthOpen);

  const shoulderL = boneGroup('shoulderL', spine, [d.shoulderX, d.shoulderY, 0]);
  attach('upperArmL', shoulderL);
  const elbowL = boneGroup('elbowL', shoulderL, [0, -d.upperArm, 0]);
  attach('foreArmL', elbowL);
  const shoulderR = boneGroup('shoulderR', spine, [-d.shoulderX, d.shoulderY, 0]);
  attach('upperArmR', shoulderR);
  const elbowR = boneGroup('elbowR', shoulderR, [0, -d.upperArm, 0]);
  attach('foreArmR', elbowR);

  const muzzles: Object3D[] = [];
  let weaponR: Group | null = null;
  let weaponL: Group | null = null;
  if (G.bones.weaponR.toon) {
    weaponR = boneGroup('weaponR', elbowR, G.weaponHand);
    weaponR.rotation.x = Math.PI / 2;
    attach('weaponR', weaponR);
    const mz = new Object3D();
    mz.position.set(...G.muzzleR!);
    weaponR.add(mz);
    muzzles.push(mz);
  }
  if (G.bones.weaponL.toon) {
    weaponL = boneGroup('weaponL', elbowL, G.weaponHand);
    weaponL.rotation.x = Math.PI / 2;
    attach('weaponL', weaponL);
    const mz = new Object3D();
    mz.position.set(...G.muzzleL!);
    weaponL.add(mz);
    muzzles.push(mz);
  }
  if (muzzles.length === 1) muzzles.push(muzzles[0]);
  const handR = new Object3D();
  handR.position.set(...G.weaponHand);
  elbowR.add(handR);
  const handL = new Object3D();
  handL.position.set(...G.weaponHand);
  elbowL.add(handL);

  return {
    look,
    dims: d,
    holo,
    root,
    body,
    roll,
    hips,
    spine,
    head,
    shoulderL,
    elbowL,
    shoulderR,
    elbowR,
    legL,
    kneeL,
    legR,
    kneeR,
    weaponR,
    weaponL,
    muzzles,
    handR,
    handL,
    eyes,
    koEyes,
    brows,
    mouth,
    mouthOpen,
    toonMat,
    glowMat,
    holoMat,
    meshes,
  };
}

export function lookOf(id: string): LookDef {
  return LOOKS[id];
}
