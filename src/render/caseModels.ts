import { BufferAttribute, BufferGeometry, Color, CylinderGeometry, Euler, Float32BufferAttribute, Group, Matrix4, Mesh, MeshBasicMaterial, type Material, Quaternion, SphereGeometry, TorusGeometry, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MAT, makeToonMaterial, outlineMaterial } from './materials';

// Beta 2.4 — the two REWARD CASES as small procedural 3D models, built the way the fighters are (primitives merged
// per part with vertex colours, the game's toon material with its material classes — lacquer, gold metal, glossy
// trim — and the inverted-hull outline), plus unlit glowing parts. No textures, no outside assets.
//
//   PRIME INVITE CASE     a premium case: deep navy lacquer, gold corners, trim and latches with turquoise gems, a
//                         turquoise light line round the lid seam, a gold-framed «TV» badge with a turquoise screen
//   DAILY BROADCAST CASE  smaller and friendlier: sky-blue body, turquoise lid, an orange gift ribbon with a bow, a
//                         little studio TV with a red ON AIR light on the front, gold hinges
//
// The lid is its own group hinged at the back edge (`lid.rotation.x` opens it); `glow` lists the materials whose
// strength the opening scene raises; `inner` is the light inside (hidden until the lid opens). Kept light (a few
// thousand triangles) so it plays smoothly on a phone.

export type CaseModelKind = 'invite' | 'daily';

export interface CaseModel {
  root: Group;
  /** The body (shakes), the lid (opens about its back edge). */
  body: Group;
  lid: Group;
  /** The glow inside the case (scaled up when it opens). */
  inner: Mesh;
  /** Glowing materials (their colour multiplied by `setGlow`). */
  setGlow(k: number): void;
  dispose(): void;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();
const _c = new Color();

/** A part list merged into one mesh (vertex colours + the toon material class per part). */
class Parts {
  private geos: BufferGeometry[] = [];
  add(g: BufferGeometry, color: number, o: { p?: number[]; r?: number[]; s?: number[] } = {}, mat: number = MAT.cloth): void {
    const p = o.p ?? [0, 0, 0];
    const r = o.r ?? [0, 0, 0];
    const s = o.s ?? [1, 1, 1];
    _e.set(r[0], r[1], r[2]);
    _q.setFromEuler(_e);
    _m.compose(_p.set(p[0], p[1], p[2]), _q, _s.set(s[0], s[1], s[2]));
    g.applyMatrix4(_m);
    if (g.getAttribute('uv')) g.deleteAttribute('uv');
    const n = g.getAttribute('position').count;
    if (!g.index) {
      const idx = new Uint16Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      g.setIndex(new BufferAttribute(idx, 1));
    }
    _c.set(color);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = _c.r;
      col[i * 3 + 1] = _c.g;
      col[i * 3 + 2] = _c.b;
    }
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    g.setAttribute('ptMat', new Float32BufferAttribute(new Float32Array(n).fill(mat), 1));
    g.setAttribute('ptThin', new Float32BufferAttribute(new Float32Array(n).fill(0), 1));
    this.geos.push(g);
  }
  build(): BufferGeometry | null {
    if (!this.geos.length) return null;
    const g = mergeGeometries(this.geos, false);
    for (const x of this.geos) x.dispose();
    this.geos = [];
    return g;
  }
}

const rbox = (w: number, h: number, d: number, r: number, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, r);
const cyl = (rt: number, rb: number, h: number, seg = 16) => new CylinderGeometry(rt, rb, h, seg, 1);
const sph = (r: number, w = 14, h = 10) => new SphereGeometry(r, w, h);
const tor = (R: number, t: number, seg = 28) => new TorusGeometry(R, t, 8, seg);

interface Palette {
  body: number;
  bodyDark: number;
  lid: number;
  gold: number;
  goldDark: number;
  glow: number;
  accent: number;
  rim: number;
}

const INVITE: Palette = { body: 0x16246b, bodyDark: 0x0d1546, lid: 0x1b2d86, gold: 0xf2c24a, goldDark: 0xb8862a, glow: 0x3ff0d8, accent: 0x3ff0d8, rim: 0x6fe9ff };
const DAILY: Palette = { body: 0x2f86e8, bodyDark: 0x1d5cb4, lid: 0x2bc6d6, gold: 0xf4c35a, goldDark: 0xc18c2c, glow: 0x7ff6ff, accent: 0xff8a2a, rim: 0x9ff3ff };

export function buildCase(kind: CaseModelKind): CaseModel {
  const P = kind === 'invite' ? INVITE : DAILY;
  const big = kind === 'invite';
  const W = big ? 1.36 : 1.08;
  const H = big ? 0.74 : 0.62;
  const Dp = big ? 0.92 : 0.78;
  const LH = big ? 0.3 : 0.26;
  const body = new Parts();
  const lid = new Parts();
  const glow = new Parts();
  const lidGlow = new Parts();

  // ---------------------------------------------------------------- body
  body.add(rbox(W, H, Dp, big ? 0.12 : 0.14), P.body, { p: [0, H / 2, 0] }, MAT.gloss);
  // a darker base plinth and a trim band at the top edge of the body
  body.add(rbox(W + 0.04, 0.08, Dp + 0.04, 0.035), P.bodyDark, { p: [0, 0.04, 0] }, MAT.gloss);
  body.add(rbox(W + 0.03, 0.05, Dp + 0.03, 0.022), P.gold, { p: [0, H - 0.03, 0] }, MAT.metal);
  if (big) {
    // PRIME INVITE: gold corner guards (the four vertical edges) and a lower gold band
    for (const sx of [1, -1])
      for (const sz of [1, -1]) body.add(rbox(0.13, H - 0.06, 0.13, 0.05), P.gold, { p: [sx * (W / 2 - 0.035), H / 2, sz * (Dp / 2 - 0.035)] }, MAT.metal);
    body.add(rbox(W + 0.02, 0.035, Dp + 0.02, 0.015), P.goldDark, { p: [0, 0.16, 0] }, MAT.metal);
  } else {
    // DAILY: rounded bumpers on the sides (friendly), hinges in gold
    for (const sx of [1, -1]) body.add(rbox(0.07, H * 0.6, Dp * 0.55, 0.03), P.bodyDark, { p: [sx * (W / 2 + 0.01), H * 0.45, 0] }, MAT.gloss);
  }
  // latches on the front (gold), with a turquoise gem (INVITE) / an orange one (DAILY)
  const latchX = big ? [W * 0.3, -W * 0.3] : [W * 0.32, -W * 0.32];
  for (const x of latchX) {
    body.add(rbox(0.13, 0.16, 0.05, 0.02), P.gold, { p: [x, H - 0.06, Dp / 2 + 0.02] }, MAT.metal);
    body.add(rbox(0.09, 0.05, 0.04, 0.015), P.goldDark, { p: [x, H - 0.15, Dp / 2 + 0.035] }, MAT.metal);
    glow.add(sph(0.026, 10, 8), big ? P.accent : P.accent, { p: [x, H - 0.05, Dp / 2 + 0.05], s: [1, 1, 0.6] });
  }
  // the front badge
  if (big) {
    // a gold-framed «TV» with a turquoise screen and two little antennae — PRIME TIME's studio sign
    const by = H * 0.46;
    body.add(rbox(0.46, 0.32, 0.05, 0.06), P.gold, { p: [0, by, Dp / 2 + 0.01] }, MAT.metal);
    body.add(rbox(0.38, 0.24, 0.04, 0.05), 0x0a1236, { p: [0, by, Dp / 2 + 0.03] }, MAT.gloss);
    glow.add(rbox(0.32, 0.18, 0.02, 0.04), P.glow, { p: [0, by, Dp / 2 + 0.052] });
    for (const s of [1, -1]) {
      body.add(cyl(0.008, 0.008, 0.14, 6), P.gold, { p: [s * 0.07, by + 0.21, Dp / 2 + 0.01], r: [0, 0, s * 0.45] }, MAT.metal);
      body.add(sph(0.018, 8, 6), P.gold, { p: [s * 0.1, by + 0.27, Dp / 2 + 0.01] }, MAT.metal);
    }
    // a gold «play» triangle on the screen
    glow.add(cyl(0.05, 0.05, 0.012, 3), 0xfff3c4, { p: [0.01, by, Dp / 2 + 0.065], r: [Math.PI / 2, 0, -Math.PI / 2] });
  } else {
    // a little studio TV with a red ON AIR light
    const by = H * 0.44;
    body.add(rbox(0.36, 0.26, 0.05, 0.06), 0xf6f2ea, { p: [0, by, Dp / 2 + 0.01] }, MAT.gloss);
    body.add(rbox(0.28, 0.18, 0.04, 0.04), 0x0f1c3d, { p: [0, by, Dp / 2 + 0.03] }, MAT.gloss);
    glow.add(rbox(0.23, 0.13, 0.02, 0.03), P.glow, { p: [0, by, Dp / 2 + 0.05] });
    glow.add(sph(0.025, 10, 8), 0xff3b4a, { p: [0.13, by + 0.17, Dp / 2 + 0.02] });
    body.add(rbox(0.08, 0.035, 0.04, 0.012), P.gold, { p: [0, by - 0.15, Dp / 2 + 0.01] }, MAT.metal);
  }

  // ---------------------------------------------------------------- lid (built hinged at the back edge: z = −Dp/2)
  const lz = Dp / 2;
  lid.add(rbox(W + 0.02, LH, Dp + 0.02, big ? 0.11 : 0.12), P.lid, { p: [0, LH / 2, lz] }, MAT.gloss);
  lid.add(rbox(W + 0.04, 0.05, Dp + 0.04, 0.022), P.gold, { p: [0, 0.025, lz] }, MAT.metal);
  if (big) {
    // a raised gold emblem plate and a gold handle on top
    lid.add(rbox(W * 0.62, 0.04, Dp * 0.55, 0.02), P.goldDark, { p: [0, LH + 0.01, lz] }, MAT.metal);
    lid.add(rbox(W * 0.56, 0.04, Dp * 0.48, 0.02), P.bodyDark, { p: [0, LH + 0.03, lz] }, MAT.gloss);
    lidGlow.add(tor(0.13, 0.016, 26), P.glow, { p: [0, LH + 0.055, lz], r: [Math.PI / 2, 0, 0] });
    lidGlow.add(sph(0.05, 12, 8), P.glow, { p: [0, LH + 0.06, lz], s: [1, 0.35, 1] });
    for (const sx of [1, -1]) lid.add(cyl(0.022, 0.022, 0.07, 10), P.gold, { p: [sx * 0.2, LH + 0.05, lz - Dp * 0.32] }, MAT.metal);
    lid.add(cyl(0.022, 0.022, 0.42, 10), P.gold, { p: [0, LH + 0.085, lz - Dp * 0.32], r: [0, 0, Math.PI / 2] }, MAT.metal);
    for (const sx of [1, -1])
      for (const sz of [1, -1]) lid.add(sph(0.06, 12, 8), P.gold, { p: [sx * (W / 2 - 0.02), LH * 0.55, lz + sz * (Dp / 2 - 0.02)], s: [1, 0.9, 1] }, MAT.metal);
    // the turquoise light line round the lid seam
    lidGlow.add(rbox(W + 0.05, 0.016, Dp + 0.05, 0.008), P.glow, { p: [0, 0.055, lz] });
  } else {
    // the gift ribbon: an orange band each way over the lid and a bow on top
    lid.add(rbox(0.13, LH + 0.012, Dp + 0.035, 0.03), P.accent, { p: [0, LH / 2 + 0.004, lz] }, MAT.gloss);
    lid.add(rbox(W + 0.035, LH + 0.012, 0.13, 0.03), P.accent, { p: [0, LH / 2 + 0.004, lz] }, MAT.gloss);
    for (const s of [1, -1]) lid.add(tor(0.08, 0.034, 18), P.accent, { p: [s * 0.075, LH + 0.06, lz], r: [0, s * 0.5, s * 0.6], s: [1, 0.75, 1] }, MAT.gloss);
    lid.add(sph(0.05, 12, 8), 0xffb35a, { p: [0, LH + 0.04, lz] }, MAT.gloss);
    // gold hinges at the back
    for (const sx of [1, -1]) lid.add(cyl(0.03, 0.03, 0.12, 10), P.gold, { p: [sx * W * 0.28, 0.02, 0.0], r: [0, 0, Math.PI / 2] }, MAT.metal);
    lidGlow.add(rbox(W + 0.04, 0.012, Dp + 0.04, 0.006), P.glow, { p: [0, 0.052, lz] });
  }

  // the lid's lining: a dark satin panel under it with a light ring (hidden inside the body while closed, seen open)
  lid.add(rbox(W * 0.86, 0.024, Dp * 0.84, 0.01), big ? 0x0b1440 : 0x15407a, { p: [0, -0.008, lz] }, MAT.cloth);
  lidGlow.add(tor(big ? 0.17 : 0.13, 0.012, 26), P.glow, { p: [0, -0.024, lz], r: [Math.PI / 2, 0, 0] });
  lidGlow.add(sph(0.035, 10, 8), big ? P.gold : P.accent, { p: [0, -0.024, lz], s: [1, 0.3, 1] });

  // ---------------------------------------------------------------- meshes
  const toon = makeToonMaterial(P.rim, 0.45);
  const glowMat = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const lidGlowMat = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const innerMat = new MeshBasicMaterial({ color: P.glow, transparent: true, opacity: 0, toneMapped: false, depthWrite: false });
  const disposables: { dispose(): void }[] = [toon, glowMat, lidGlowMat, innerMat];
  const mesh = (g: BufferGeometry | null, m: Material, outline: boolean): Group | Mesh | null => {
    if (!g) return null;
    disposables.push(g);
    const me = new Mesh(g, m);
    if (!outline) return me;
    const grp = new Group();
    grp.add(me);
    grp.add(new Mesh(g, outlineMaterial()));
    return grp;
  };
  const root = new Group();
  const bodyG = new Group();
  const lidG = new Group();
  for (const x of [mesh(body.build(), toon, true), mesh(glow.build(), glowMat, false)]) if (x) bodyG.add(x);
  for (const x of [mesh(lid.build(), toon, true), mesh(lidGlow.build(), lidGlowMat, false)]) if (x) lidG.add(x);
  // the hinge: the lid group sits on the body's back top edge; its parts were built forward of it
  lidG.position.set(0, H, -Dp / 2);
  bodyG.add(lidG);
  // the light inside: a soft disc just under the lid line (seen when it opens)
  const innerGeo = new CylinderGeometry(W * 0.42, W * 0.42, 0.02, 24, 1);
  disposables.push(innerGeo);
  const inner = new Mesh(innerGeo, innerMat);
  inner.position.set(0, H - 0.02, 0);
  bodyG.add(inner);
  root.add(bodyG);
  // centre the case on its middle (the scene spins and bounces it around there)
  bodyG.position.y = -(H + LH) / 2;
  const glowBase = new Color(1, 1, 1);
  return {
    root,
    body: bodyG,
    lid: lidG,
    inner,
    setGlow(k: number) {
      glowMat.color.copy(glowBase).multiplyScalar(k);
      lidGlowMat.color.copy(glowBase).multiplyScalar(k * 1.1);
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
