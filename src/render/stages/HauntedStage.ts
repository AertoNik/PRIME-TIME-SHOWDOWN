import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import { arenaById } from '../../config/arenas.config';
import { ARENA } from '../../config/balance';
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
  swingCones,
  tint,
  WALL_TOP,
  type DecorLayout,
  type SpotCone,
  type StageShared,
} from './StageKit';

// HAUNTED PRIME SET — MIDNIGHT BROADCAST (Halloween Premiere). A mystic mansion set
// the channel built for its Halloween fights — clearly a set: a plywood gothic
// mansion with its scaffolding showing, a stage moon on a rig, studio lamps in the
// graveyard. Atmospheric, never gory: jack-o'-lanterns burst into orange shards and
// violet smoke, gravestones crack and topple, lanterns go out, the fog gate puffs
// theatrical fog when shots land nearby.

const DEF = arenaById('haunted');
const _c = new Color();
const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _up = new Vector3(0, 1, 0);
const FONT = 'Unbounded, "Arial Black", sans-serif';

// ------------------------------------------------------------------ textures
function drawFloor(): { map: CanvasTexture; emissive: CanvasTexture } {
  const { c, g, e, eg, X, Y, ppu, W, H } = floorCanvas(1024);
  g.fillStyle = '#16121e';
  g.fillRect(0, 0, W, H);
  // irregular flagstones
  const rng = new Rng(66);
  const rowH = 0.9 * ppu;
  for (let y = 0; y < H; y += rowH) {
    let x = -rng.range(0, 40);
    while (x < W) {
      const w = rng.range(0.7, 1.4) * ppu;
      const v = rng.range(30, 52);
      g.fillStyle = `rgb(${v + 6}, ${v}, ${v + 16})`;
      g.beginPath();
      g.roundRect(x + 3, y + 3, w - 6, rowH - 6, 8);
      g.fill();
      if (rng.chance(0.18)) {
        g.fillStyle = 'rgba(60, 120, 70, 0.25)'; // a little moss
        g.beginPath();
        g.ellipse(x + rng.range(10, w - 10), y + rng.range(8, rowH - 8), rng.range(6, 18), rng.range(3, 8), 0, 0, Math.PI * 2);
        g.fill();
      }
      x += w;
    }
  }
  // fallen leaves
  for (let i = 0; i < 70; i++) {
    g.fillStyle = rng.chance(0.5) ? 'rgba(200, 100, 30, 0.7)' : 'rgba(120, 60, 30, 0.7)';
    g.save();
    g.translate(rng.range(0, W), rng.range(0, H));
    g.rotate(rng.range(0, 6));
    g.beginPath();
    g.ellipse(0, 0, 7, 3.5, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  // violet glow creeping in from the barrier
  for (const ctx of [g, eg]) {
    ctx.save();
    ctx.strokeStyle = ctx === eg ? 'rgba(160, 70, 255, 0.55)' : 'rgba(150, 70, 230, 0.6)';
    ctx.lineWidth = 0.5 * ppu;
    if (ctx === eg) {
      ctx.shadowColor = 'rgba(170, 80, 255, 0.9)';
      ctx.shadowBlur = 30;
    }
    ctx.beginPath();
    insetPath(ctx, X, Y, ppu, ARENA.wallX - 0.25, ARENA.wallZ - 0.25, ARENA.wallCorner - 0.25);
    ctx.stroke();
    ctx.restore();
  }
  // centre crest: crescent moon in a ring, a faint orange glow
  for (const ctx of [g, eg]) {
    ctx.save();
    ctx.translate(X(0), Y(0));
    ctx.strokeStyle = ctx === eg ? 'rgba(255, 140, 40, 0.5)' : 'rgba(255, 150, 60, 0.45)';
    ctx.lineWidth = 6;
    if (ctx === eg) {
      ctx.shadowColor = 'rgba(255, 140, 40, 0.8)';
      ctx.shadowBlur = 16;
    }
    ctx.beginPath();
    ctx.arc(0, 0, 2.2 * ppu, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 1.85 * ppu, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = ctx === eg ? 'rgba(255, 170, 70, 0.35)' : 'rgba(255, 190, 90, 0.25)';
    ctx.beginPath();
    ctx.arc(-0.2 * ppu, 0, 1.0 * ppu, 0, Math.PI * 2);
    ctx.arc(0.25 * ppu, -0.15 * ppu, 0.85 * ppu, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    ctx.restore();
  }
  g.save();
  g.translate(X(0), Y(0));
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `italic 900 ${Math.round(ppu * 0.38)}px ${FONT}`;
  g.fillStyle = 'rgba(255, 200, 120, 0.18)';
  g.fillText('MIDNIGHT', 0.55 * ppu, 0.7 * ppu);
  g.restore();
  // contender marks: moonlight lavender for the player, pumpkin orange for the rival
  for (const [z, col] of [
    [ARENA.halfZ + 0.6, 'rgba(190, 170, 255, 0.85)'],
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
  return { map: canvasTexture(c), emissive: canvasTexture(e) };
}

function groundTexture(): CanvasTexture {
  const t = paintTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#120e18';
    g.fillRect(0, 0, w, h);
    const rng = new Rng(9);
    for (let i = 0; i < 500; i++) {
      g.fillStyle = rng.chance(0.3) ? 'rgba(40, 70, 40, 0.35)' : 'rgba(40, 30, 50, 0.4)';
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
    const rng = new Rng(13);
    for (let i = 0; i < 26; i++) {
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

function stoneTexture(): CanvasTexture {
  return paintTexture(128, 160, (g, w, h) => {
    g.fillStyle = '#5a5664';
    g.fillRect(0, 0, w, h);
    const rng = new Rng(3);
    for (let i = 0; i < 200; i++) {
      const v = rng.range(70, 110);
      g.fillStyle = `rgba(${v}, ${v - 4}, ${v + 10}, 0.35)`;
      g.fillRect(rng.range(0, w), rng.range(0, h), 3, 3);
    }
    g.fillStyle = 'rgba(30, 26, 36, 0.8)';
    g.textAlign = 'center';
    g.font = `900 22px ${FONT}`;
    g.fillText('R.I.P', w / 2, 56);
    g.fillRect(w / 2 - 22, 72, 44, 3);
    g.fillRect(w / 2 - 16, 82, 32, 3);
  });
}

function crackTexture(): CanvasTexture {
  return paintTexture(128, 160, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(15, 10, 20, 0.95)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(w * 0.55, 0);
    g.lineTo(w * 0.42, h * 0.3);
    g.lineTo(w * 0.62, h * 0.48);
    g.lineTo(w * 0.38, h * 0.75);
    g.lineTo(w * 0.5, h);
    g.moveTo(w * 0.62, h * 0.48);
    g.lineTo(w * 0.85, h * 0.6);
    g.stroke();
  });
}

function pumpkinFace(): CanvasTexture {
  return paintTexture(256, 128, (g, w, h) => {
    g.fillStyle = '#2a1000';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffcf4a';
    g.shadowColor = '#ffb020';
    g.shadowBlur = 6;
    const cx = 64;
    for (const dx of [-15, 15]) {
      g.beginPath();
      g.moveTo(cx + dx - 8, 56);
      g.lineTo(cx + dx + 8, 56);
      g.lineTo(cx + dx, 42);
      g.closePath();
      g.fill();
    }
    g.beginPath();
    g.moveTo(cx - 22, 70);
    g.quadraticCurveTo(cx, 88, cx + 22, 70);
    g.lineTo(cx + 14, 76);
    g.lineTo(cx + 8, 72);
    g.lineTo(cx, 79);
    g.lineTo(cx - 8, 72);
    g.lineTo(cx - 14, 76);
    g.closePath();
    g.fill();
  });
}

function batTexture(): CanvasTexture {
  return paintTexture(128, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(w / 2, h * 0.35);
    g.quadraticCurveTo(w * 0.3, h * 0.05, 4, h * 0.3);
    g.quadraticCurveTo(w * 0.2, h * 0.5, w * 0.18, h * 0.75);
    g.quadraticCurveTo(w * 0.33, h * 0.55, w / 2, h * 0.8);
    g.quadraticCurveTo(w * 0.67, h * 0.55, w * 0.82, h * 0.75);
    g.quadraticCurveTo(w * 0.8, h * 0.5, w - 4, h * 0.3);
    g.quadraticCurveTo(w * 0.7, h * 0.05, w / 2, h * 0.35);
    g.fill();
  });
}

/** Ribbed jack-o'-lantern (carved face toward +Z at u = 0.25). */
function pumpkinGeometry(): BufferGeometry {
  const body = new SphereGeometry(1, 20, 12);
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
  tint(body, 0xff7a1a);
  const stem = new CylinderGeometry(0.07, 0.12, 0.34, 7);
  stem.rotateZ(0.18);
  stem.translate(0.02, 1.48, 0);
  const uv = stem.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.75, 0.98);
  tint(stem, 0x4a7a2a);
  return merge([body, stem]);
}

// ------------------------------------------------------------------ set pieces
interface Pumpkin {
  body: Mesh;
  mat: MeshStandardMaterial;
  shards: Mesh[];
  x: number;
  z: number;
  y: number;
  broken: boolean;
  phase: number;
}

interface Grave {
  group: Group;
  crack: Mesh;
  rune: MeshBasicMaterial;
  stage: number;
  fall: number;
  shake: number;
  yaw: number;
}

interface LanternP {
  head: Group;
  glow: MeshBasicMaterial;
  flame: Mesh;
  out: number;
  flicker: number;
  broken: boolean;
}

interface Bat {
  r: number;
  h: number;
  cx: number;
  cz: number;
  speed: number;
  phase: number;
  size: number;
}

const LAYOUT: DecorLayout = {
  spots: [
    [-7.0, GROUND_Y, -5.4, 0.5],
    [7.0, GROUND_Y, -5.4, 0.5],
    [-7.3, GROUND_Y, 4.6, 0.46],
    [7.3, GROUND_Y, 4.6, 0.46],
    [-3.4, GROUND_Y, -12.4, 0.48],
    [3.4, GROUND_Y, -12.4, 0.48],
    [-8.6, GROUND_Y, -11.0, 0.5],
    [8.6, GROUND_Y, -11.0, 0.5],
    [-10.6, GROUND_Y, -1.8, 0.5],
    [10.6, GROUND_Y, -1.8, 0.5],
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
    { x: 0, y: 5.6, z: -14.6, rx: -0.08, ry: 0, w: 7.6, h: 4.0, front: 0.2, size: 1.7 },
    { x: -11.0, y: 4.2, z: -10.2, rx: -0.12, ry: 0.72, w: 4.6, h: 2.7, front: 0.16, size: 1.1 },
    { x: 11.0, y: 4.2, z: -10.2, rx: -0.12, ry: -0.72, w: 4.6, h: 2.7, front: 0.16, size: 1.1 },
  ],
  banners: [
    [-5.4, 7.0, -14.2, 0],
    [5.4, 7.0, -14.2, 0],
    [-12.4, 6.0, -6.6, 0.7],
    [12.4, 6.0, -6.6, -0.7],
  ],
  bats: { r: [4, 8], h: [8, 11], cx: [-5, 5], cz: [-17, -13] },
};

export class HauntedStage extends Stage {
  readonly id = 'haunted' as const;
  readonly layout = LAYOUT;
  private cones: SpotCone[] = [];
  private pieces = new Pieces();
  private pumpkins: Pumpkin[] = [];
  private graves: Grave[] = [];
  private lanterns: LanternP[] = [];
  private propMap: ({ k: 'pumpkin'; i: number } | { k: 'grave'; i: number } | { k: 'lantern'; i: number } | { k: 'gate' })[] = [];
  private fogPlanes: Mesh[] = [];
  private fogMat!: MeshBasicMaterial;
  private bats!: InstancedMesh;
  private batData: Bat[] = [];
  private batScare = 0;
  private moonGlow!: MeshBasicMaterial;
  private windows: MeshBasicMaterial[] = [];
  private gateSign!: MeshBasicMaterial;
  private gateFlicker = 0;
  private premiere!: MeshBasicMaterial;
  private postGlow!: MeshBasicMaterial;
  private pumpkinGeo!: BufferGeometry;
  private gatePos = new Vector3();

  constructor(shared: StageShared) {
    super(shared);
    this.pumpkinGeo = pumpkinGeometry();
    this.buildFloor();
    this.buildBarrier();
    this.buildMansion();
    this.buildGraveyard();
    this.buildFog();
    this.buildBats();
    this.buildProps();
    this.buildLights();
  }

  private buildFloor(): void {
    const { map, emissive } = drawFloor();
    this.group.add(floorMesh(map, emissive, { roughness: 0.82, metalness: 0.05, emissiveIntensity: 1.2 }, 0x15101c));
    const ground = new Mesh(new PlaneGeometry(90, 90), new MeshStandardMaterial({ map: groundTexture(), roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = GROUND_Y;
    this.group.add(ground);
  }

  /** Stone base with an iron spear fence on top and stone pillars with lantern caps. */
  private buildBarrier(): void {
    const stone = new MeshStandardMaterial({ color: 0x3a3444, roughness: 0.95, metalness: 0.02 });
    const wall = new Mesh(flatExtrude(ringShape(ARENA.wallX, ARENA.wallZ, ARENA.wallCorner, 0.45), WALL_TOP), stone);
    wall.castShadow = true;
    wall.receiveShadow = true;
    this.group.add(wall);
    const iron = new MeshStandardMaterial({ color: 0x15121c, roughness: 0.5, metalness: 0.6 });
    const rail = flatExtrude(ringShape(ARENA.wallX + 0.16, ARENA.wallZ + 0.16, ARENA.wallCorner + 0.16, 0.05), 0.04);
    rail.translate(0, WALL_TOP + 0.42, 0);
    this.group.add(new Mesh(rail, iron));
    // pickets with spear tips (one instanced mesh)
    const picket = merge([new CylinderGeometry(0.018, 0.018, 0.46, 5).translate(0, 0.23, 0), new ConeGeometry(0.04, 0.12, 5).translate(0, 0.52, 0)]);
    const hx = ARENA.wallX + 0.18;
    const hz = ARENA.wallZ + 0.18;
    const r = ARENA.wallCorner + 0.18;
    const per = 2 * (2 * (hx - r) + 2 * (hz - r)) + 2 * Math.PI * r;
    const n = Math.round(per / 0.3);
    const pickets = new InstancedMesh(picket, iron, n);
    for (let i = 0; i < n; i++) {
      const p = pointOnRing(hx, hz, r, (i / n) * per);
      _m.makeTranslation(p.x, WALL_TOP, p.z);
      pickets.setMatrixAt(i, _m);
    }
    this.group.add(pickets);
    // stone pillars with glowing lantern caps
    const W = ARENA.wallX + 0.22;
    const Z = ARENA.wallZ + 0.22;
    const c = ARENA.wallCorner;
    const k = 0.29;
    const posts: [number, number][] = [
      [-W, 0],
      [W, 0],
      [-(W - c * k), -(Z - c * k)],
      [W - c * k, -(Z - c * k)],
      [-(W - c * k), Z - c * k],
      [W - c * k, Z - c * k],
    ];
    const pil: BufferGeometry[] = [];
    const caps: BufferGeometry[] = [];
    for (const [x, z] of posts) {
      pil.push(new BoxGeometry(0.5, 1.3, 0.5).translate(x, 0.65, z));
      pil.push(new BoxGeometry(0.62, 0.12, 0.62).translate(x, 1.34, z));
      caps.push(new BoxGeometry(0.22, 0.26, 0.22).translate(x, 1.54, z));
    }
    this.group.add(new Mesh(merge(pil), stone));
    this.postGlow = new MeshBasicMaterial({ color: new Color(0xff9a3a).multiplyScalar(2.2), toneMapped: false });
    this.group.add(new Mesh(merge(caps), this.postGlow));
  }

  /** The plywood gothic mansion with its glowing windows, the gate, the stage moon and signs. */
  private buildMansion(): void {
    // silhouette of the flat: main house, two towers with pointed roofs
    const s = new Shape();
    s.moveTo(-9, 0);
    s.lineTo(-9, 6);
    s.lineTo(-7.6, 6);
    s.lineTo(-7.6, 8.4);
    s.lineTo(-6.6, 10.6);
    s.lineTo(-5.6, 8.4);
    s.lineTo(-5.6, 7);
    s.lineTo(-3, 7);
    s.lineTo(0, 9.4);
    s.lineTo(3, 7);
    s.lineTo(5.6, 7);
    s.lineTo(5.6, 9.2);
    s.lineTo(6.8, 12);
    s.lineTo(8, 9.2);
    s.lineTo(8, 6);
    s.lineTo(9, 6);
    s.lineTo(9, 0);
    s.closePath();
    const flat = new ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: false });
    const houseMat = new MeshStandardMaterial({ color: 0x241c30, roughness: 0.9, emissive: 0x0a0612 });
    const house = new Mesh(flat, houseMat);
    house.position.set(0, GROUND_Y, -15.6);
    this.group.add(house);
    // roof trim lines (to read against the dark)
    const trim = new MeshBasicMaterial({ color: new Color(0x8a5ad8).multiplyScalar(1.2) });
    const tr: BufferGeometry[] = [];
    const roofEdge = (x0: number, y0: number, x1: number, y1: number) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      const g = new BoxGeometry(len, 0.08, 0.04);
      g.rotateZ(Math.atan2(y1 - y0, x1 - x0));
      tr.push(g.translate((x0 + x1) / 2, GROUND_Y + (y0 + y1) / 2, -15.46));
    };
    roofEdge(-3, 7, 0, 9.4);
    roofEdge(0, 9.4, 3, 7);
    roofEdge(-7.6, 8.4, -6.6, 10.6);
    roofEdge(-6.6, 10.6, -5.6, 8.4);
    roofEdge(5.6, 9.2, 6.8, 12);
    roofEdge(6.8, 12, 8, 9.2);
    this.group.add(new Mesh(merge(tr), trim));
    // glowing windows (some orange, some violet; they breathe)
    const winGeoms: Record<string, BufferGeometry[]> = { a: [], b: [] };
    const win = (x: number, y: number, w: number, h: number, key: 'a' | 'b') => {
      const shape = new Shape();
      shape.moveTo(-w / 2, 0);
      shape.lineTo(w / 2, 0);
      shape.lineTo(w / 2, h * 0.7);
      shape.lineTo(0, h);
      shape.lineTo(-w / 2, h * 0.7);
      shape.closePath();
      const g = new ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false });
      winGeoms[key].push(g.translate(x, GROUND_Y + y, -15.44));
    };
    for (const x of [-7.6, -4.4, 4.4, 7.0]) {
      win(x, 1.6, 0.9, 1.5, x < 0 ? 'a' : 'b');
      win(x, 4.1, 0.9, 1.4, x < 0 ? 'b' : 'a');
    }
    win(-6.6, 7.4, 0.6, 1.1, 'a');
    win(6.8, 8.4, 0.6, 1.2, 'b');
    for (const [key, col] of [
      ['a', 0xffa040],
      ['b', 0xb070ff],
    ] as [string, number][]) {
      const m = new MeshBasicMaterial({ color: new Color(col).multiplyScalar(1.8), toneMapped: false });
      this.windows.push(m);
      this.group.add(new Mesh(merge(winGeoms[key]), m));
    }
    // the back of the flat: battens and braces (it is a set)
    const wood = new MeshStandardMaterial({ color: 0x7a5e3a, roughness: 0.85 });
    const sc: BufferGeometry[] = [];
    for (let x = -8.5; x <= 8.5; x += 1.7) sc.push(new BoxGeometry(0.1, 7, 0.1).translate(x, GROUND_Y + 3.5, -15.8));
    for (const y of [1.5, 4, 6.4]) sc.push(new BoxGeometry(18, 0.1, 0.1).translate(0, GROUND_Y + y, -15.8));
    for (const x of [-6, 0, 6]) {
      const b = new BoxGeometry(0.1, 6.5, 0.1);
      b.rotateX(-0.45);
      sc.push(b.translate(x, GROUND_Y + 3, -17.2));
    }
    this.group.add(new Mesh(merge(sc), wood));
    // studio wall far behind
    const back = new Mesh(new PlaneGeometry(44, 18), new MeshStandardMaterial({ color: 0x0c0914, roughness: 0.95 }));
    back.position.set(0, 8, -19.5);
    this.group.add(back);
    for (const sx of [-1, 1]) {
      const side = new Mesh(new PlaneGeometry(34, 18), new MeshStandardMaterial({ color: 0x0c0914, roughness: 0.95 }));
      side.position.set(sx * 16.5, 8, -3);
      side.rotation.y = (-sx * Math.PI) / 2;
      this.group.add(side);
    }

    // big screen in a pointed gothic frame on the house front
    const frameMat = new MeshStandardMaterial({ color: 0x1a1222, roughness: 0.5, metalness: 0.4, emissive: 0x12081e });
    const scrMat = new MeshBasicMaterial({ map: this.sh.screenTex, toneMapped: false });
    const scr = new Group();
    scr.add(new Mesh(new BoxGeometry(7.6, 4.0, 0.3), frameMat));
    const sm = new Mesh(new PlaneGeometry(7.1, 3.6), scrMat);
    sm.position.z = 0.16;
    scr.add(sm);
    const arch = new Mesh(new ConeGeometry(3.9, 1.2, 4, 1, true, Math.PI / 4), frameMat);
    arch.scale.set(1, 1, 0.08);
    arch.position.y = 2.6;
    scr.add(arch);
    const edge = new Mesh(new TorusGeometry(0.06, 0.03, 6, 8), trim);
    edge.scale.set(64, 34, 1);
    scr.add(edge);
    scr.position.set(0, 5.6, -14.6);
    scr.rotation.x = -0.08;
    this.group.add(scr);
    // side "mystic" screens
    for (const sx of [-1, 1]) {
      const g = new Group();
      g.add(new Mesh(new BoxGeometry(4.6, 2.7, 0.26), frameMat));
      const m2 = new Mesh(new PlaneGeometry(4.2, 2.3), scrMat);
      m2.position.z = 0.14;
      g.add(m2);
      g.position.set(sx * 11.0, 4.2, -10.2);
      g.rotation.set(-0.12, -sx * 0.72, 0);
      this.group.add(g);
    }

    // stage moon on its rig (truss arm from the side)
    const moon = new Mesh(new CircleGeometry(2.4, 40), new MeshBasicMaterial({ color: new Color(0xfff2d0).multiplyScalar(1.5), toneMapped: false }));
    moon.position.set(-9.6, 11.2, -17.6);
    this.group.add(moon);
    this.moonGlow = new MeshBasicMaterial({
      map: paintTexture(256, 256, (g, w, h) => {
        const grd = g.createRadialGradient(w / 2, h / 2, w * 0.18, w / 2, h / 2, w / 2);
        grd.addColorStop(0, 'rgba(220, 210, 255, 0.55)');
        grd.addColorStop(1, 'rgba(160, 120, 255, 0)');
        g.fillStyle = grd;
        g.fillRect(0, 0, w, h);
      }),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const halo = new Mesh(new PlaneGeometry(9, 9), this.moonGlow);
    halo.position.set(-9.6, 11.2, -17.7);
    this.group.add(halo);
    // craters
    const craters: BufferGeometry[] = [];
    for (const [dx, dy, r] of [
      [-0.7, 0.5, 0.45],
      [0.6, -0.3, 0.6],
      [0.3, 0.9, 0.25],
      [-0.4, -0.9, 0.3],
    ])
      craters.push(new CircleGeometry(r, 16).translate(-9.6 + dx, 11.2 + dy, -17.58));
    this.group.add(new Mesh(merge(craters), new MeshBasicMaterial({ color: new Color(0xd8ccb0).multiplyScalar(1.2), toneMapped: false })));
    const steel = new MeshStandardMaterial({ color: 0x2a2a34, roughness: 0.4, metalness: 0.8 });
    this.group.add(new Mesh(merge([new CylinderGeometry(0.08, 0.08, 6, 6).rotateZ(Math.PI / 2).translate(-13.6, 11.2, -17.9), new CylinderGeometry(0.08, 0.08, 12, 6).translate(-15.8, 6, -17.9)]), steel));

    // the gate behind the north barrier: stone pillars, iron arch, MIDNIGHT BROADCAST sign
    const gx = 0;
    const gz = -ARENA.wallZ - 1.05;
    this.gatePos.set(gx, 0.4, gz);
    const gate: BufferGeometry[] = [];
    for (const sx of [-1, 1]) {
      gate.push(new BoxGeometry(0.6, 2.6, 0.6).translate(gx + sx * 1.9, GROUND_Y + 1.3, gz));
      gate.push(new BoxGeometry(0.8, 0.2, 0.8).translate(gx + sx * 1.9, GROUND_Y + 2.7, gz));
    }
    this.group.add(new Mesh(merge(gate), new MeshStandardMaterial({ color: 0x3a3444, roughness: 0.95 })));
    const archGeo = new TorusGeometry(1.9, 0.06, 6, 24, Math.PI);
    const ironMat = new MeshStandardMaterial({ color: 0x15121c, roughness: 0.5, metalness: 0.6 });
    const ga = new Mesh(archGeo, ironMat);
    ga.position.set(gx, GROUND_Y + 2.6, gz);
    this.group.add(ga);
    const bars: BufferGeometry[] = [];
    for (let i = -6; i <= 6; i++) bars.push(new CylinderGeometry(0.02, 0.02, 2.4, 4).translate(gx + i * 0.26, GROUND_Y + 1.2, gz));
    this.group.add(new Mesh(merge(bars), ironMat));
    this.gateSign = neonMaterial(drawNeon('MIDNIGHT BROADCAST', '#c070ff', 1024, 256, 84), 1.6);
    const gs = new Mesh(new PlaneGeometry(4.6, 1.15), this.gateSign);
    gs.position.set(gx, GROUND_Y + 3.6, gz + 0.1);
    this.group.add(gs);
    // fog machine beside the gate (a studio box with a nozzle)
    const fx = new Mesh(merge([new BoxGeometry(0.7, 0.45, 0.5).translate(0, 0.22, 0), new CylinderGeometry(0.06, 0.08, 0.3, 8).rotateX(Math.PI / 2).translate(0, 0.26, 0.38)]), steel);
    fx.position.set(gx + 2.8, GROUND_Y, gz + 0.3);
    fx.rotation.y = -0.4;
    this.group.add(fx);

    // HALLOWEEN PREMIERE sign above the house
    this.premiere = neonMaterial(drawNeon('HALLOWEEN PREMIERE', '#ff8a1f', 1024, 256, 84), 1.5);
    const pm = new Mesh(new PlaneGeometry(10, 2.5), this.premiere);
    pm.position.set(1.2, 12.6, -15.8);
    this.group.add(pm);
  }

  /** Decorative graveyard outside the ring: stones, dead trees, pumpkin piles, studio lamps. */
  private buildGraveyard(): void {
    const rng = new Rng(404);
    // gravestones (one instanced mesh of a rounded headstone)
    const stoneGeo = merge([new BoxGeometry(0.7, 0.8, 0.16).translate(0, 0.4, 0), new CylinderGeometry(0.35, 0.35, 0.16, 12, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).translate(0, 0.8, 0)]);
    const stoneMat = new MeshStandardMaterial({ map: stoneTexture(), roughness: 0.95 });
    const spots: [number, number, number][] = [];
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 5; i++) spots.push([sx * rng.range(6.6, 9.8), rng.range(-9.8, 3.8), rng.range(0.7, 1.15)]);
      spots.push([sx * rng.range(4.5, 8.5), rng.range(-13.6, -11.4), rng.range(0.8, 1.2)]);
    }
    const stones = new InstancedMesh(stoneGeo, stoneMat, spots.length);
    spots.forEach(([x, z, s], i) => {
      _q.setFromAxisAngle(_up, Math.atan2(-x, -z) + rng.range(-0.3, 0.3));
      const tilt = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), rng.range(-0.12, 0.12));
      _q.multiply(tilt);
      _m.compose(_p.set(x, GROUND_Y, z), _q, _s.setScalar(s));
      stones.setMatrixAt(i, _m);
    });
    this.group.add(stones);
    // twisted dead trees
    const bark = new MeshStandardMaterial({ color: 0x2a1e24, roughness: 0.95 });
    const trees: BufferGeometry[] = [];
    const tree = (x: number, z: number, s: number) => {
      trees.push(new CylinderGeometry(0.12 * s, 0.28 * s, 3.2 * s, 7).rotateZ(0.08).translate(x, GROUND_Y + 1.6 * s, z));
      const branches: [number, number, number, number][] = [
        [0.9, 2.2, 0.9, 1.4],
        [-0.8, 2.6, -1.0, 1.2],
        [0.4, 3.0, 0.5, 0.9],
        [-0.5, 1.6, -0.7, 0.9],
      ];
      for (const [dx, y, rz, len] of branches) {
        const b = new CylinderGeometry(0.03 * s, 0.09 * s, len * s, 5);
        b.rotateZ(-rz);
        trees.push(b.translate(x + dx * 0.5 * s, GROUND_Y + y * s, z));
      }
    };
    tree(-8.6, -8.4, 1.3);
    tree(8.9, -7.6, 1.2);
    tree(-10.4, 2.4, 1.0);
    tree(10.2, 1.2, 1.1);
    tree(-4.6, -13.2, 1.1);
    this.group.add(new Mesh(merge(trees), bark));
    // pumpkin piles near the mansion and the gate (decor; not interactive)
    const pmat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.55, emissiveMap: pumpkinFace(), emissive: new Color(1, 0.62, 0.22), emissiveIntensity: 2.2 });
    const piles: [number, number, number][] = [
      [2.6, -9.2, 0.42],
      [3.2, -9.6, 0.32],
      [-2.7, -9.3, 0.38],
      [-6.6, -12.4, 0.5],
      [6.2, -12.6, 0.46],
      [5.6, -12.0, 0.3],
      [-9.8, -4.4, 0.45],
      [9.8, -4.0, 0.42],
    ];
    const pp = new InstancedMesh(this.pumpkinGeo, pmat, piles.length);
    piles.forEach(([x, z, s], i) => {
      _q.setFromAxisAngle(_up, Math.atan2(-x, 6 - z));
      _m.compose(_p.set(x, GROUND_Y, z), _q, _s.setScalar(s));
      pp.setMatrixAt(i, _m);
    });
    this.group.add(pp);
    // studio lamps on stands in the graveyard (it is still a TV set)
    const steel = new MeshStandardMaterial({ color: 0x24242e, roughness: 0.4, metalness: 0.7 });
    const lens = new MeshBasicMaterial({ color: new Color(0xc890ff).multiplyScalar(2.4), toneMapped: false });
    for (const [x, z] of [
      [-7.4, -10.4],
      [7.6, -10.6],
    ] as [number, number][]) {
      const g = new Group();
      g.position.set(x, GROUND_Y, z);
      g.rotation.y = Math.atan2(-x, -z);
      g.add(new Mesh(merge([new CylinderGeometry(0.04, 0.05, 2.6, 6).translate(0, 1.3, 0), new ConeGeometry(0.5, 0.3, 3).translate(0, 0.15, 0)]), steel));
      const head = new Mesh(new CylinderGeometry(0.24, 0.28, 0.5, 12).rotateX(Math.PI / 2 - 0.5), steel);
      head.position.y = 2.7;
      g.add(head);
      const l = new Mesh(new CircleGeometry(0.22, 12), lens);
      l.position.set(0, 2.6, 0.27);
      l.rotation.x = -0.5;
      g.add(l);
      this.group.add(g);
    }
  }

  /** Low theatrical fog drifting outside the barrier (never over the fighting floor). */
  private buildFog(): void {
    this.fogMat = new MeshBasicMaterial({ map: fogTexture(), color: new Color(0xb8a0ff).multiplyScalar(0.9), transparent: true, depthWrite: false, opacity: 0.85 });
    const strips: [number, number, number, number, number][] = [
      [0, -10.2, 22, 4, 0],
      [-8.2, -2, 4.6, 16, 0],
      [8.2, -2, 4.6, 16, 0],
      [0, -13.8, 24, 4, 0],
    ];
    for (const [x, z, w, d] of strips) {
      const m = new Mesh(new PlaneGeometry(w, d), this.fogMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, GROUND_Y + 0.25, z);
      m.renderOrder = 2;
      (m.userData as { w: number; d: number }).w = w;
      this.fogPlanes.push(m);
      this.group.add(m);
    }
    (this.fogMat.map as CanvasTexture).repeat.set(3, 3);
  }

  private buildBats(): void {
    const rng = new Rng(17);
    const mat = new MeshBasicMaterial({ map: batTexture(), color: 0x1a0c26, transparent: true, alphaTest: 0.35, side: DoubleSide });
    this.bats = new InstancedMesh(new PlaneGeometry(1, 0.5), mat, 8);
    this.bats.frustumCulled = false;
    for (let i = 0; i < 8; i++) {
      this.batData.push({ r: rng.range(3, 7), h: rng.range(8, 11.5), cx: rng.range(-6, 6), cz: rng.range(-17, -14), speed: rng.range(0.25, 0.45) * (rng.chance(0.5) ? 1 : -1), phase: rng.range(0, 6.28), size: rng.range(0.7, 1.1) });
    }
    this.group.add(this.bats);
  }

  // --------------------------------------------------------------------- props
  private buildProps(): void {
    const face = pumpkinFace();
    const stoneMat = new MeshStandardMaterial({ map: stoneTexture(), roughness: 0.95 });
    const crackTex = crackTexture();
    DEF.props.forEach((p, idx) => {
      if (p.kind === 'pumpkin') {
        this.propMap[idx] = { k: 'pumpkin', i: this.pumpkins.length };
        this.pumpkins.push(this.buildPumpkin(p.x, p.z, face));
      } else if (p.kind === 'gravestone') {
        this.propMap[idx] = { k: 'grave', i: this.graves.length };
        this.graves.push(this.buildGrave(p.x, p.z, stoneMat, crackTex));
      } else if (p.kind === 'lantern') {
        this.propMap[idx] = { k: 'lantern', i: this.lanterns.length };
        this.lanterns.push(this.buildLantern(p.x, p.z));
      } else if (p.kind === 'fogGate') {
        this.propMap[idx] = { k: 'gate' };
      }
    });
  }

  private buildPumpkin(x: number, z: number, face: CanvasTexture): Pumpkin {
    const y = landingY(x, z);
    const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.55, emissiveMap: face, emissive: new Color(1, 0.62, 0.22), emissiveIntensity: 2.6 });
    const body = new Mesh(this.pumpkinGeo, mat);
    body.position.set(x, y, z);
    body.rotation.y = Math.atan2(-x, -z);
    body.scale.setScalar(0.42);
    body.castShadow = true;
    this.group.add(body);
    const shardMat = new MeshLambertMaterial({ color: 0xff7a1a, emissive: new Color(0x5a2000) });
    const shards: Mesh[] = [];
    for (let i = 0; i < 6; i++) {
      const g = new SphereGeometry(0.2, 5, 4, (i / 6) * Math.PI * 2, Math.PI / 3, 0.2, 1.6);
      const m = new Mesh(g, shardMat);
      m.visible = false;
      this.group.add(m);
      shards.push(m);
    }
    return { body, mat, shards, x, z, y, broken: false, phase: (x * 7 + z * 3) % 6 };
  }

  private buildGrave(x: number, z: number, mat: Material, crackTex: CanvasTexture): Grave {
    const y = landingY(x, z);
    const yaw = Math.atan2(-x, -z);
    const group = new Group();
    group.position.set(x, y, z - Math.sign(z) * 0.05);
    group.rotation.y = yaw;
    const stone = new Mesh(merge([new BoxGeometry(0.62, 0.72, 0.16).translate(0, 0.36, 0), new CylinderGeometry(0.31, 0.31, 0.16, 12, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).translate(0, 0.72, 0)]), mat);
    stone.castShadow = true;
    group.add(stone);
    const crack = new Mesh(new PlaneGeometry(0.62, 0.95), new MeshBasicMaterial({ map: crackTex, transparent: true, depthWrite: false }));
    crack.position.set(0, 0.5, 0.085);
    crack.visible = false;
    group.add(crack);
    // a faint emerald rune that glows until the stone falls
    const rune = new MeshBasicMaterial({ color: new Color(0x6aff9a).multiplyScalar(1.2), toneMapped: false, transparent: true, opacity: 0.85 });
    const r = new Mesh(new TorusGeometry(0.1, 0.018, 6, 16), rune);
    r.position.set(0, 0.86, 0.09);
    group.add(r);
    this.group.add(group);
    return { group, crack, rune, stage: 0, fall: 0, shake: 0, yaw };
  }

  private buildLantern(x: number, z: number): LanternP {
    const y = landingY(x, z);
    const iron = new MeshStandardMaterial({ color: 0x15121c, roughness: 0.5, metalness: 0.6 });
    const post = new Group();
    post.position.set(x, y, z);
    post.add(new Mesh(merge([new CylinderGeometry(0.035, 0.05, 1.5, 6).translate(0, 0.75, 0), new BoxGeometry(0.42, 0.04, 0.04).translate(0.16, 1.5, 0)]), iron));
    const head = new Group();
    head.position.set(0.34, 1.48, 0);
    head.add(new Mesh(merge([new BoxGeometry(0.2, 0.03, 0.2).translate(0, -0.02, 0), new ConeGeometry(0.16, 0.14, 4).rotateY(Math.PI / 4).translate(0, -0.06, 0), new BoxGeometry(0.2, 0.03, 0.2).translate(0, -0.34, 0)]), iron));
    const glow = new MeshBasicMaterial({ color: new Color(0xffa040).multiplyScalar(2.2), toneMapped: false, transparent: true, opacity: 0.9 });
    const cage = new Mesh(new BoxGeometry(0.17, 0.28, 0.17), glow);
    cage.position.y = -0.18;
    head.add(cage);
    const flame = new Mesh(new SphereGeometry(0.05, 8, 6), new MeshBasicMaterial({ color: new Color(0xfff0c0).multiplyScalar(3), toneMapped: false }));
    flame.position.y = -0.18;
    head.add(flame);
    post.rotation.y = Math.atan2(-x, -z) + Math.PI / 2;
    post.add(head);
    this.group.add(post);
    return { head, glow, flame, out: 0, flicker: 0, broken: false };
  }

  private buildLights(): void {
    const housing = new MeshStandardMaterial({ color: 0x1a1422, roughness: 0.4, metalness: 0.7 });
    const spots: [number, number, number, number][] = [
      [-9, -6, 0xa64dff, 0.5],
      [9, -6, 0xff7a1a, -0.5],
      [-9, 4, 0x6a8aff, 0.6],
      [9, 4, 0xd04dff, -0.6],
    ];
    for (const [x, z, col, yaw] of spots) {
      const c = makeSpotCone(x, 11, z, col, yaw, housing, 0.2);
      this.group.add(c.pivot);
      this.cones.push(c);
    }
  }

  override applyTheme(th: ArenaTheme, isDefault: boolean): void {
    colorCones(this.cones, isDefault || th.decor === 'pumpkins' ? [0xa64dff, 0xff7a1a, 0x6a8aff, 0xd04dff] : th.spots);
    // BOSS FIGHT here: the gate announces the title fight
    this.premiere.map?.dispose();
    this.premiere.map = th.decor === 'championHalloween' || th.decor === 'champion' ? drawNeon('LEGENDARY · HALLOWEEN', '#ffc23a', 1024, 256, 78) : drawNeon('HALLOWEEN PREMIERE', '#ff8a1f', 1024, 256, 84);
    this.premiere.needsUpdate = true;
  }

  override setSpots(colors: number[]): void {
    colorCones(this.cones, colors);
  }

  // ---------------------------------------------------------- set-piece events
  propHit(i: number, hp: number, heavy: boolean, x: number, z: number): void {
    const m = this.propMap[i];
    if (!m) return;
    const vfx = this.vfx;
    if (m.k === 'gate') {
      // theatrical fog jets from the gate machine, the sign flickers, the bats take off
      this.gateFlicker = 0.8;
      this.batScare = 2.5;
      if (vfx) {
        const g = this.gatePos;
        for (let k = 0; k < (heavy ? 10 : 6); k++) {
          const a = (k / 6) * Math.PI;
          vfx.soft.spawn(g.x + (k - 3) * 0.45, 0.2, g.z + 0.4, Math.cos(a) * 0.8, 0.5 + (k % 3) * 0.2, 1.2, 1.6, 0.6, 2.2, _c.set(0xc8b8ff), 1, 1.4, -0.08);
        }
        vfx.glow(g.x, 1.4, g.z, _c.set(0xa64dff), 0.6, 3.2, 0.4, 1.6);
      }
      return;
    }
    if (m.k === 'grave') {
      // first hit: the stone cracks and leans
      const gr = this.graves[m.i];
      gr.stage = Math.max(gr.stage, 2 - hp);
      gr.crack.visible = true;
      gr.shake = 0.4;
      gr.group.rotation.z = (Math.sign(x || 1) * 0.08);
      if (vfx) {
        vfx.debrisBurst(x, 0.9, z, _c.set(0x6a6474), 5);
        vfx.burst(x, 0.9, z, _c.set(0x6aff9a), 10, 3, 0.1, 0.4, 1.8, 2, 1);
      }
    }
  }

  propBreak(i: number, x: number, z: number): void {
    const m = this.propMap[i];
    if (!m) return;
    const vfx = this.vfx;
    if (m.k === 'pumpkin') {
      const p = this.pumpkins[m.i];
      p.broken = true;
      // the lantern bursts: shards fly, a warm flash, violet smoke; a squashed shell stays
      p.body.scale.set(0.42, 0.16, 0.42);
      p.mat.emissiveIntensity = 0.2;
      p.shards.forEach((s, k) => {
        s.visible = true;
        s.position.set(p.x, p.y + 0.3, p.z);
        s.rotation.set(0, k, 0);
        const a = (k / p.shards.length) * Math.PI * 2;
        const land = landingY(p.x + Math.cos(a) * 0.9, p.z + Math.sin(a) * 0.9);
        this.pieces.launch(s, [Math.cos(a) * 2.4, 3.2 + (k % 2) * 1.2, Math.sin(a) * 2.4], [6, 4 + k, 5], land + 0.05);
      });
      if (vfx) {
        vfx.flash(x, 0.9, z, _c.set(0xffb040), 0.5, 2.6, 0.22, 2.4);
        vfx.burst(x, 0.8, z, _c.set(0xff8a1f), 26, 6, 0.13, 0.5, 2.4, 8, 2);
        for (let k = 0; k < 5; k++) vfx.soft.spawn(x + (k - 2) * 0.2, 0.9, z, (k - 2) * 0.3, 0.7, 0, 1.2, 0.5, 1.5, _c.set(0x8a4adf), 1, 2.2, -0.3);
      }
      this.batScare = Math.max(this.batScare, 1.4);
    } else if (m.k === 'grave') {
      const gr = this.graves[m.i];
      gr.stage = 2;
      gr.crack.visible = true;
      gr.fall = 0.0001;
      if (vfx) {
        vfx.debrisBurst(x, 0.7, z, _c.set(0x5a5664), 10);
        vfx.dust(x, z, 12);
        vfx.burst(x, 0.9, z, _c.set(0x6aff9a), 18, 4, 0.12, 0.5, 2, 3, 1.5);
      }
    } else if (m.k === 'lantern') {
      const L = this.lanterns[m.i];
      L.broken = true;
      L.flicker = 0.9;
      if (vfx) {
        const hp = L.head.getWorldPosition(new Vector3());
        vfx.burst(hp.x, hp.y, hp.z, _c.set(0xffc060), 16, 5, 0.09, 0.4, 2.6, 9, 1);
        vfx.soft.spawn(hp.x, hp.y, hp.z, 0, 0.6, 0, 1.0, 0.3, 1.0, _c.set(0x4a3a5a), 1, 2, -0.3);
      }
    }
  }

  resetProps(): void {
    this.pieces.clear();
    for (const p of this.pumpkins) {
      p.broken = false;
      p.body.scale.setScalar(0.42);
      p.mat.emissiveIntensity = 2.6;
      p.shards.forEach((s) => (s.visible = false));
    }
    for (const g of this.graves) {
      g.stage = 0;
      g.fall = 0;
      g.shake = 0;
      g.crack.visible = false;
      g.group.rotation.set(0, g.yaw, 0);
      g.rune.opacity = 0.85;
    }
    for (const L of this.lanterns) {
      L.broken = false;
      L.flicker = 0;
      L.out = 0;
      L.head.rotation.set(0, 0, 0);
      L.glow.opacity = 0.9;
      L.flame.visible = true;
    }
    this.gateFlicker = 0;
    this.batScare = 0;
  }

  // ---------------------------------------------------------------------- frame
  update(dt: number, ex: number, boost: number): void {
    this.time += dt;
    const t = this.time;
    const mo = this.motion;
    swingCones(this.cones, t, ex * 0.7, boost, mo * 0.6);
    // fog drifts slowly (paused with reduced motion off; thinner on low quality)
    const map = this.fogMat.map!;
    map.offset.x = (t * 0.015 * mo) % 1;
    map.offset.y = (t * 0.008 * mo) % 1;
    this.fogMat.opacity = this.low ? 0.5 : 0.85;
    for (const m of this.fogPlanes) m.visible = !this.low || m === this.fogPlanes[0];
    // window and moon breathing, sign flicker
    this.windows.forEach((w, i) => w.color.setHex(i ? 0xb070ff : 0xffa040).multiplyScalar(1.6 + Math.sin(t * 1.3 + i * 2) * 0.25 + boost * 0.5));
    this.moonGlow.opacity = 0.85 + Math.sin(t * 0.7) * 0.15;
    this.gateFlicker = Math.max(0, this.gateFlicker - dt);
    // rapid flicker only with full motion (reduced motion: a slow fade)
    const fl = mo > 0.5 ? 55 : 6;
    this.gateSign.color.setScalar(this.gateFlicker > 0 ? (Math.sin(t * fl) > 0 ? 1.8 : 0.4) : 1.5 + Math.sin(t * 2.2) * 0.1);
    this.premiere.color.setScalar(1.45 + boost * 0.5);
    this.postGlow.color.setHex(0xff9a3a).multiplyScalar(2 + Math.sin(t * 5.3) * 0.25);
    // pumpkins flicker like candles
    for (const p of this.pumpkins) if (!p.broken) p.mat.emissiveIntensity = 2.4 + Math.sin(t * 7 + p.phase) * 0.25 + Math.sin(t * 13 + p.phase) * 0.15 + ex * 0.4;
    // gravestones: shake after a crack, topple when broken, the rune fades
    for (const g of this.graves) {
      if (g.shake > 0) {
        g.shake = Math.max(0, g.shake - dt);
        g.group.position.y += Math.sin(t * 60) * 0.004 * g.shake;
      }
      if (g.fall > 0 && g.fall < 1) {
        g.fall = Math.min(1, g.fall + dt * 2.2);
        g.group.rotation.x = -(g.fall * g.fall) * 1.35;
        g.rune.opacity = 0.85 * (1 - g.fall);
      }
    }
    // lanterns: flicker, go out and droop
    for (const L of this.lanterns) {
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
    // bats circle the towers; a smash nearby scatters them for a moment
    this.batScare = Math.max(0, this.batScare - dt);
    const scare = this.batScare > 0 ? 1 + this.batScare : 1;
    for (let i = 0; i < this.batData.length; i++) {
      const b = this.batData[i];
      const a = b.phase + t * b.speed * scare * (0.4 + 0.6 * mo);
      const flap = 0.35 + Math.abs(Math.sin(t * 9 * scare + i)) * 0.65;
      _p.set(b.cx + Math.cos(a) * b.r * (this.batScare > 0 ? 1.3 : 1), b.h + Math.sin(t * 1.3 + i) * 0.4, b.cz + Math.sin(a) * b.r * 0.45);
      _q.setFromAxisAngle(_up, -a + (b.speed > 0 ? 0 : Math.PI));
      _m.compose(_p, _q, _s.set(b.size, b.size * flap, b.size));
      this.bats.setMatrixAt(i, _m);
    }
    this.bats.instanceMatrix.needsUpdate = true;
    if (this.pieces.busy) this.pieces.update(dt);
  }
}
