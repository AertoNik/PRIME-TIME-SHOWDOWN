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
  /** Gauntlet: muzzle lives on the forearm. */
  muzzleFore: V3 | null;
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
    if (look.top.style === 'vest' || look.top.style === 'puffer') {
      P.add(rbox(0.12, 0.08, 0.04, 0.015), 0xffc23a, { p: [0, d.pelvisH * 0.42, d.pelvisD * 0.52] });
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
    }
    // neck
    T.add(cyl(d.neckR, d.neckR * 1.1, 0.16, 14), skinDark, { p: [0, d.neckY - 0.02, 0] });

    // shoulder pads for tech / puffer
    if (top.style === 'tech') {
      for (const ss of [1, -1]) {
        T.add(sph(d.armR * 1.6, 12, 10), top.accent, { p: [ss * d.shoulderX, d.shoulderY + 0.05, 0], s: [1.1, 0.6, 1] });
      }
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
    if (look.accessories.includes('chain')) {
      const ch = tor(0.2, 0.026, Math.PI * 2, 30);
      T.add(ch, 0xffc23a, { p: [0, d.neckY - 0.08, 0.13], r: [1.15, 0, 0], s: [1.25, 1, 1] });
      T.add(rbox(0.09, 0.11, 0.03, 0.02), 0xffd76a, { p: [0, d.neckY - 0.25, torsoR(d, d.neckY - 0.25) * d.depth + 0.05] });
    }
  }

  // ----------------------------------------------------------------- arms
  const sleeveMain = look.top.style === 'vest' || look.top.style === 'puffer' ? skin : look.top.main;
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
    }
    // forearm
    F.add(cap(ar * (bare ? 1.05 : 1.12), d.foreArm * 0.55), sleeveMain, { p: [0, -d.foreArm * 0.45, 0] });
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
  const hx = R;
  const hy = R * 0.94;
  const hz = R * 0.92;
  const faceZ = (x: number, y: number) => hz * Math.sqrt(Math.max(0, 1 - (x / hx) ** 2 - (y / hy) ** 2));
  {
    const H = B.t('head');
    const HG = B.g('head');
    H.add(sph(R, 30, 22), skin, { p: [0, cy, 0.02], s: [1, 0.94, 0.92] });
    if (look.body === 'heavy') {
      // square jaw
      H.add(sph(R * 0.82, 20, 14), skin, { p: [0, cy - R * 0.3, -0.02], s: [1.14, 0.72, 0.9] });
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
    const eh = look.body === 'heavy' ? 0.92 : 1.08;
    eyes.add(sph(0.1, 16, 12), 0xffffff, { p: [x, 0, z], s: [0.82, eh, 0.45], r: [0, yaw, 0] });
    eyes.add(sph(0.062, 14, 10), look.eyes, { p: [x * 0.97, -0.004, z + 0.03], s: [0.82, 1.06 * eh, 0.4], r: [0, yaw, 0] });
    eyes.add(sph(0.034, 10, 8), 0x0b0b12, { p: [x * 0.97, -0.006, z + 0.045], s: [0.85, 1.05 * eh, 0.4], r: [0, yaw, 0] });
    eyes.add(sph(0.017, 8, 6), 0xffffff, { p: [x * 0.97 - 0.018, 0.024, z + 0.058], r: [0, yaw, 0] });
    // KO "x" eyes
    koEyes.add(rbox(0.12, 0.025, 0.02, 0.01), 0x101018, { p: [x, 0, z + 0.04], r: [0, yaw, 0.785] });
    koEyes.add(rbox(0.12, 0.025, 0.02, 0.01), 0x101018, { p: [x, 0, z + 0.04], r: [0, yaw, -0.785] });
  }
  const brows = new PartSet();
  const browC = look.hair.style === 'cap' || look.hair.style === 'beanie' ? look.hair.color2 : look.hair.style === 'mohawk' ? look.hair.color2 : look.hair.color;
  for (const s of [1, -1]) {
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
  const mouthPivot: V3 = [look.mouth === 'smirk' ? 0.04 : 0, cy + mouthY, faceZ(0, mouthY) + 0.012];
  const mouth = new PartSet();
  const mouthOpen = new PartSet();
  const lip = 0x2a1418;
  if (look.mouth === 'flat') {
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
  let muzzleFore: V3 | null = null;
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
  } else {
    // gauntlet on right forearm (arm space: arm points -y)
    const F = B.t('foreArmR');
    const FG = B.g('foreArmR');
    const ar = d.armR;
    F.add(cyl(ar * 1.55, ar * 1.4, d.foreArm * 0.62, 18), wc, { p: [0, -d.foreArm * 0.55, 0] });
    F.add(rbox(ar * 1.6, d.foreArm * 0.45, 0.06, 0.02), wd, { p: [0, -d.foreArm * 0.52, ar * 1.45] });
    FG.add(rbox(ar * 0.9, d.foreArm * 0.3, 0.02, 0.008), gl, { p: [0, -d.foreArm * 0.52, ar * 1.5 + 0.03] }, GLOW);
    const ring = tor(ar * 1.45, 0.025, Math.PI * 2, 22);
    ring.rotateX(Math.PI / 2);
    FG.add(ring, gl, { p: [0, -d.foreArm * 0.88, 0] }, GLOW);
    const ring2 = tor(ar * 1.55, 0.02, Math.PI * 2, 22);
    ring2.rotateX(Math.PI / 2);
    FG.add(ring2, gl, { p: [0, -d.foreArm * 0.24, 0] }, GLOW);
    F.add(sph(0.05, 10, 8), wd, { p: [ar * 1.5, -d.foreArm * 0.5, 0] });
    muzzleFore = [0, -d.foreArm - d.handR * 1.9, 0.02];
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
    muzzleFore,
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
  if (G.muzzleFore) {
    const mz = new Object3D();
    mz.position.set(...G.muzzleFore);
    elbowR.add(mz);
    muzzles.push(mz);
  }
  if (muzzles.length === 1) muzzles.push(muzzles[0]);

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
