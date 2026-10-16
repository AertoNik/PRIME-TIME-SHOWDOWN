import {
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  RepeatWrapping,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Points,
} from 'three';
import { arenaById } from '../../config/arenas.config';
import { ARENA } from '../../config/balance';
import type { ArenaTheme } from '../../config/themes.config';
import { Rng } from '../../core/math';
import { canvasTexture } from '../textures';
import {
  buildCrowd,
  colorCones,
  colorSticks,
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

// LUXURY CASINO SET — HIGH ROLLER SHOWDOWN. Not a casino: a TV studio dressed as
// one for the VIP episodes. Black glossy floor with gold inlay, red velvet barrier
// with marquee bulbs, VIP balconies with an audience, gold columns, curtains, gaming
// tables beside the ring, giant chips — and set pieces that react to stray shots:
// chip stacks burst, the HIGH ROLLER neon sign breaks in stages, the roulette
// wheels spin up when something lands nearby.

const DEF = arenaById('casino');
const _m = new Matrix4();
const _c = new Color();
const GOLD = 0xe0b04a;
const CHIP_COLORS = [0xc8102e, 0x14141a, 0x1f4fd8, 0x1a8a4a, 0xf2f2f2, 0x6a1fa8];

// ------------------------------------------------------------------ textures
function drawFloor(): { map: CanvasTexture; emissive: CanvasTexture } {
  const { c, g, e, eg, X, Y, ppu, W, H } = floorCanvas(1024);
  const base = g.createRadialGradient(W / 2, H / 2, 30, W / 2, H / 2, H * 0.62);
  base.addColorStop(0, '#2a0a10');
  base.addColorStop(0.6, '#16060a');
  base.addColorStop(1, '#0b0306');
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  // art-deco diamond lattice in dark gold
  g.strokeStyle = 'rgba(214, 165, 70, 0.13)';
  g.lineWidth = 2;
  const step = ppu * 1.4;
  for (let k = -H; k < W + H; k += step) {
    g.beginPath();
    g.moveTo(k, 0);
    g.lineTo(k + H, H);
    g.stroke();
    g.beginPath();
    g.moveTo(k, H);
    g.lineTo(k + H, 0);
    g.stroke();
  }
  // polished reflections: soft diagonal sheen bands
  g.save();
  g.globalAlpha = 0.05;
  g.fillStyle = '#ffd9a0';
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    const x0 = W * (0.1 + i * 0.27);
    g.moveTo(x0, 0);
    g.lineTo(x0 + 60, 0);
    g.lineTo(x0 + 60 - H * 0.6, H);
    g.lineTo(x0 - H * 0.6, H);
    g.fill();
  }
  g.restore();

  const gold = (draw: (ctx: CanvasRenderingContext2D) => void, width: number, alpha = 0.9, glow = 1) => {
    for (const ctx of [g, eg]) {
      ctx.save();
      ctx.strokeStyle = ctx === eg ? `rgba(255, 200, 90, ${0.6 * glow})` : `rgba(230, 180, 80, ${alpha})`;
      ctx.lineWidth = width;
      if (ctx === eg) {
        ctx.shadowColor = 'rgba(255, 190, 70, 0.9)';
        ctx.shadowBlur = width * 2.5;
      }
      ctx.beginPath();
      draw(ctx);
      ctx.stroke();
      ctx.restore();
    }
  };
  // double gold border following the barrier
  gold((ctx) => insetPath(ctx, X, Y, ppu, ARENA.wallX - 0.32, ARENA.wallZ - 0.32, ARENA.wallCorner - 0.32), 5);
  gold((ctx) => insetPath(ctx, X, Y, ppu, ARENA.wallX - 0.62, ARENA.wallZ - 0.62, ARENA.wallCorner - 0.62), 2, 0.6, 0.5);
  // corner sunbursts
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const cx = X(sx * (ARENA.wallX - 0.65));
      const cz = Y(sz * (ARENA.wallZ - 0.65));
      g.save();
      g.translate(cx, cz);
      const a0 = Math.atan2(-sz, -sx);
      for (let i = -3; i <= 3; i++) {
        const a = a0 + i * 0.2;
        g.strokeStyle = 'rgba(230, 180, 80, 0.32)';
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(Math.cos(a) * ppu * 1.5, Math.sin(a) * ppu * 1.5);
        g.stroke();
      }
      g.restore();
    }
  }
  // centre medallion: roulette ring of red / black wedges inside gold rings
  const R0 = 1.7 * ppu;
  const R1 = 2.3 * ppu;
  g.save();
  g.translate(X(0), Y(0));
  for (let i = 0; i < 37; i++) {
    const a = (i / 37) * Math.PI * 2;
    const b = ((i + 1) / 37) * Math.PI * 2;
    g.fillStyle = i === 0 ? 'rgba(20, 110, 60, 0.75)' : i % 2 ? 'rgba(160, 14, 34, 0.72)' : 'rgba(12, 8, 10, 0.85)';
    g.beginPath();
    g.arc(0, 0, R1, a, b);
    g.arc(0, 0, R0, b, a, true);
    g.closePath();
    g.fill();
  }
  const disc = g.createRadialGradient(0, 0, 0, 0, 0, R0);
  disc.addColorStop(0, 'rgba(255, 220, 150, 0.12)');
  disc.addColorStop(1, 'rgba(255, 200, 120, 0.03)');
  g.fillStyle = disc;
  g.beginPath();
  g.arc(0, 0, R0, 0, Math.PI * 2);
  g.fill();
  g.rotate(-0.06);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `italic 900 ${Math.round(ppu * 0.5)}px Unbounded, "Arial Black", sans-serif`;
  g.fillStyle = 'rgba(255, 215, 130, 0.3)';
  g.fillText('HIGH', 0, -ppu * 0.3);
  g.fillText('ROLLER', 0, ppu * 0.32);
  g.restore();
  gold((ctx) => ctx.arc(X(0), Y(0), R1 + 4, 0, Math.PI * 2), 6);
  gold((ctx) => ctx.arc(X(0), Y(0), R0 - 4, 0, Math.PI * 2), 4);
  // corner marks of the two contenders: warm white for the player, crimson for the rival
  for (const [z, col] of [
    [ARENA.halfZ + 0.6, 'rgba(255, 236, 200, 0.85)'],
    [-ARENA.halfZ - 0.6, 'rgba(255, 60, 70, 0.85)'],
  ] as [number, string][]) {
    for (const ctx of [g, eg]) {
      ctx.save();
      ctx.strokeStyle = col;
      ctx.lineWidth = 5;
      if (ctx === eg) {
        ctx.shadowColor = col;
        ctx.shadowBlur = 14;
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

function carpetTexture(): CanvasTexture {
  const t = paintTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#2a070c';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(200, 140, 60, 0.35)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(w / 2, 8);
    g.lineTo(w - 8, h / 2);
    g.lineTo(w / 2, h - 8);
    g.lineTo(8, h / 2);
    g.closePath();
    g.stroke();
    g.fillStyle = 'rgba(200, 140, 60, 0.3)';
    g.beginPath();
    g.arc(w / 2, h / 2, 14, 0, Math.PI * 2);
    g.fill();
    for (const [x, y] of [
      [0, 0],
      [w, 0],
      [0, h],
      [w, h],
    ])
      g.fillRect(x - 6, y - 6, 12, 12);
  });
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(26, 26);
  return t;
}

/** Folded theatre curtain (red velvet, darker folds, gold hem). */
function curtainTexture(): CanvasTexture {
  return paintTexture(256, 512, (g, w, h) => {
    for (let x = 0; x < w; x++) {
      const k = 0.55 + 0.45 * Math.cos((x / w) * Math.PI * 8);
      g.fillStyle = `rgb(${Math.round(70 + 90 * k)}, ${Math.round(6 + 10 * k)}, ${Math.round(16 + 16 * k)})`;
      g.fillRect(x, 0, 1, h);
    }
    const shade = g.createLinearGradient(0, 0, 0, h);
    shade.addColorStop(0, 'rgba(0,0,0,0.45)');
    shade.addColorStop(0.3, 'rgba(0,0,0,0)');
    shade.addColorStop(1, 'rgba(0,0,0,0.2)');
    g.fillStyle = shade;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#d9a440';
    g.fillRect(0, h - 22, w, 10);
  });
}

/** VIP balcony front: red velvet panels in gold frames. */
function balconyTexture(): CanvasTexture {
  const t = paintTexture(512, 64, (g, w, h) => {
    g.fillStyle = '#4a0610';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) {
      const x = i * 128;
      g.fillStyle = '#7a0c1c';
      g.fillRect(x + 10, 10, 108, h - 20);
      g.strokeStyle = '#e0b04a';
      g.lineWidth = 3;
      g.strokeRect(x + 10, 10, 108, h - 20);
      g.fillStyle = '#e0b04a';
      g.beginPath();
      g.arc(x + 64, h / 2, 6, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#e0b04a';
    g.fillRect(0, 0, w, 4);
    g.fillRect(0, h - 4, w, 4);
  });
  t.wrapS = RepeatWrapping;
  return t;
}

/** Chip edge (side): white inserts the instance colour does not tint (emissive). */
function chipSideTexture(emissive: boolean): CanvasTexture {
  const t = paintTexture(256, 16, (g, w, h) => {
    g.fillStyle = emissive ? '#000' : '#e8e8e8';
    g.fillRect(0, 0, w, h);
    g.fillStyle = emissive ? '#fff' : '#ffffff';
    for (let i = 0; i < 8; i++) g.fillRect(i * 32 + 8, 2, 14, h - 4);
  });
  return t;
}

function chipFaceTexture(emissive: boolean): CanvasTexture {
  return paintTexture(128, 128, (g, w, h) => {
    g.fillStyle = emissive ? '#000' : '#e0e0e0';
    g.fillRect(0, 0, w, h);
    g.translate(w / 2, h / 2);
    if (emissive) {
      g.fillStyle = '#fff';
      for (let i = 0; i < 8; i++) {
        g.save();
        g.rotate((i / 8) * Math.PI * 2);
        g.fillRect(-7, -60, 14, 14);
        g.restore();
      }
      g.strokeStyle = 'rgba(255,255,255,0.7)';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(0, 0, 34, 0, Math.PI * 2);
      g.stroke();
    } else {
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(0, 0, 30, 0, Math.PI * 2);
      g.fill();
    }
  });
}

function rouletteTexture(): CanvasTexture {
  return paintTexture(256, 256, (g, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    g.fillStyle = '#3a1a0a';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 37; i++) {
      const a = (i / 37) * Math.PI * 2;
      const b = ((i + 1) / 37) * Math.PI * 2;
      g.fillStyle = i === 0 ? '#138a4a' : i % 2 ? '#b8102a' : '#141014';
      g.beginPath();
      g.moveTo(cx, cy);
      g.arc(cx, cy, 124, a, b);
      g.closePath();
      g.fill();
    }
    g.fillStyle = '#5a2a10';
    g.beginPath();
    g.arc(cx, cy, 86, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#e0b04a';
    g.lineWidth = 4;
    for (const r of [124, 98, 86]) {
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = '#fff';
    g.font = 'bold 11px Arial';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let i = 0; i < 37; i++) {
      const a = ((i + 0.5) / 37) * Math.PI * 2;
      g.fillText(String((i * 13) % 37), cx + Math.cos(a) * 111, cy + Math.sin(a) * 111);
    }
  });
}

function signNeon(text: string, color: string): CanvasTexture {
  return drawNeon(text, color, 512, 192, text.length > 4 ? 104 : 120);
}

// ------------------------------------------------------------------- props
interface ChipStack {
  i0: number;
  n: number;
  x: number;
  z: number;
  home: Matrix4[];
  objs: Object3D[];
  base: Mesh;
  broken: boolean;
  shake: number;
}

interface Wheel {
  group: Group;
  disc: Group;
  ball: Mesh;
  speed: number;
  ballA: number;
  kick: number;
}

const LAYOUT: DecorLayout = {
  spots: [
    [-4.3, WALL_TOP, -7.22, 0.3],
    [4.3, WALL_TOP, -7.22, 0.34],
    [-5.2, WALL_TOP, 6.31, 0.28],
    [5.2, WALL_TOP, 6.31, 0.3],
    [-7.1, GROUND_Y, -5.0, 0.5],
    [7.1, GROUND_Y, -5.0, 0.52],
    [-7.2, GROUND_Y, 2.9, 0.48],
    [7.2, GROUND_Y, 2.9, 0.46],
    [-3.6, 1.0, -12.0, 0.36],
    [3.6, 1.0, -12.0, 0.36],
    [-7.4, 1.0, -11.6, 0.38],
    [7.4, 1.0, -11.6, 0.4],
    [-2.2, 2.6, -13.8, 0.32],
    [2.2, 2.6, -13.8, 0.32],
    [-10.9, GROUND_Y, -6.5, 0.5],
    [10.9, GROUND_Y, -6.5, 0.5],
  ],
  menuSpots: [
    [-1.95, 0, 0.55, 0.42],
    [1.85, 0, 0.95, 0.32],
    [-1.35, 0, -1.25, 0.28],
    [1.5, 0, -1.0, 0.24],
  ],
  screens: [
    { x: 0, y: 6.0, z: -16.6, rx: -0.12, ry: 0, w: 9.8, h: 5.1, front: 0.2, size: 2.1 },
    { x: -11.2, y: 4.4, z: -10.5, rx: -0.12, ry: 0.72, w: 5.0, h: 2.9, front: 0.17, size: 1.2 },
    { x: 11.2, y: 4.4, z: -10.5, rx: -0.12, ry: -0.72, w: 5.0, h: 2.9, front: 0.17, size: 1.2 },
  ],
  banners: [
    [-7.85, 6.4, -11.5, 0],
    [7.85, 6.4, -11.5, 0],
    [-12.6, 6.2, -6.8, 0.7],
    [12.6, 6.2, -6.8, -0.7],
  ],
  bats: { r: [4, 8], h: [7.5, 10.5], cx: [-6, 6], cz: [-16, -12] },
};

export class CasinoStage extends Stage {
  readonly id = 'casino' as const;
  readonly layout = LAYOUT;
  private cones: SpotCone[] = [];
  private sticks!: Points;
  private bulbs!: InstancedMesh;
  private bulbCount = 0;
  private bulbT = 0;
  private bulbPhase = 0;
  private topSign!: MeshBasicMaterial;
  private suitSigns: MeshBasicMaterial[] = [];
  private chips!: InstancedMesh;
  private stacks: ChipStack[] = [];
  private wheels: Wheel[] = [];
  private pieces = new Pieces();
  private sign!: {
    group: Group;
    high: MeshBasicMaterial;
    roller: MeshBasicMaterial;
    bulbs: MeshBasicMaterial;
    stage: number;
    flicker: number;
    tilt: number;
  };
  /** prop index → what it is on this set */
  private propMap: ({ k: 'sign' } | { k: 'chips'; s: number } | { k: 'wheel'; w: number })[] = [];
  private gold!: MeshStandardMaterial;

  constructor(shared: StageShared) {
    super(shared);
    this.gold = new MeshStandardMaterial({ color: GOLD, metalness: 0.55, roughness: 0.32, emissive: 0x4a2e08 });
    this.buildFloor();
    this.buildBarrier();
    this.buildBackdrop();
    this.buildSides();
    this.buildProps();
    this.buildLights();
  }

  // ----------------------------------------------------------- floor & barrier
  private buildFloor(): void {
    const { map, emissive } = drawFloor();
    this.group.add(floorMesh(map, emissive, { roughness: 0.22, metalness: 0.35, emissiveIntensity: 1.25 }, 0x1a0508));
    const ground = new Mesh(new PlaneGeometry(90, 90), new MeshStandardMaterial({ map: carpetTexture(), roughness: 0.95, metalness: 0 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = GROUND_Y;
    this.group.add(ground);
  }

  private buildBarrier(): void {
    const h = WALL_TOP;
    const velvet = new MeshStandardMaterial({ color: 0x5c0a16, roughness: 0.88, metalness: 0.05, emissive: 0x12020a });
    const wall = new Mesh(flatExtrude(ringShape(ARENA.wallX, ARENA.wallZ, ARENA.wallCorner, 0.45), h), velvet);
    wall.castShadow = true;
    wall.receiveShadow = true;
    this.group.add(wall);
    // gold rail on top and a thin gold strip near the floor
    const cap = flatExtrude(ringShape(ARENA.wallX + 0.02, ARENA.wallZ + 0.02, ARENA.wallCorner + 0.02, 0.42), 0.07);
    cap.translate(0, h, 0);
    this.group.add(new Mesh(cap, this.gold));
    const strip = flatExtrude(ringShape(ARENA.wallX - 0.01, ARENA.wallZ - 0.01, ARENA.wallCorner - 0.01, 0.03), 0.05);
    strip.translate(0, 0.12, 0);
    this.group.add(new Mesh(strip, this.gold));
    // marquee bulbs along the inner edge of the rail (chase animation in update)
    const pts: Vector3[] = [];
    const hx = ARENA.wallX + 0.08;
    const hz = ARENA.wallZ + 0.08;
    const r = ARENA.wallCorner + 0.08;
    const per = 2 * (2 * (hx - r) + 2 * (hz - r)) + 2 * Math.PI * r;
    const n = Math.round(per / 0.42);
    for (let i = 0; i < n; i++) pts.push(pointOnRing(hx, hz, r, (i / n) * per));
    const bulbGeo = new SphereGeometry(0.055, 8, 6);
    const bulbMat = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.bulbs = new InstancedMesh(bulbGeo, bulbMat, pts.length);
    pts.forEach((p, i) => {
      _m.makeTranslation(p.x, h + 0.1, p.z);
      this.bulbs.setMatrixAt(i, _m);
      this.bulbs.setColorAt(i, _c.setHex(0xffe0a0).multiplyScalar(2));
    });
    this.bulbCount = pts.length;
    this.group.add(this.bulbs);
    // gold posts with crystal caps
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
    const postParts: BufferGeometry[] = [];
    const capParts: BufferGeometry[] = [];
    for (const [x, z] of posts) {
      postParts.push(new CylinderGeometry(0.2, 0.26, 1.2, 12).translate(x, 0.6, z));
      postParts.push(new CylinderGeometry(0.3, 0.3, 0.1, 12).translate(x, 1.24, z));
      capParts.push(new SphereGeometry(0.17, 12, 8).translate(x, 1.42, z));
    }
    this.group.add(new Mesh(merge(postParts), this.gold));
    const crystal = new MeshBasicMaterial({ color: new Color(0xfff0c8).multiplyScalar(2.4), toneMapped: false });
    this.group.add(new Mesh(merge(capParts), crystal));
  }

  // ------------------------------------------------------------------- backdrop
  private buildBackdrop(): void {
    const rng = new Rng(201);
    // back wall and the big curtain
    const wallMat = new MeshStandardMaterial({ color: 0x1a0609, roughness: 0.9 });
    const back = new Mesh(new PlaneGeometry(40, 16), wallMat);
    back.position.set(0, 7.6, -18.2);
    this.group.add(back);
    const curtain = new MeshStandardMaterial({ map: curtainTexture(), roughness: 0.85, side: DoubleSide });
    const drape = new Mesh(new PlaneGeometry(30, 12), curtain);
    drape.position.set(0, 6, -17.8);
    (curtain.map as CanvasTexture).wrapS = RepeatWrapping;
    (curtain.map as CanvasTexture).repeat.set(6, 1);
    this.group.add(drape);
    // side drapes framing the screen
    const sideCurtain = new MeshStandardMaterial({ map: curtainTexture(), roughness: 0.85, side: DoubleSide });
    for (const sx of [-1, 1]) {
      const d = new Mesh(new PlaneGeometry(2.6, 9.5), sideCurtain);
      d.position.set(sx * 6.1, 5.6, -16.9);
      this.group.add(d);
    }

    // big screen with a gold frame and the VIP SHOWDOWN marquee
    const scrMat = new MeshBasicMaterial({ map: this.sh.screenTex, toneMapped: false });
    const big = new Group();
    const frame = new Mesh(new BoxGeometry(9.8, 5.1, 0.35), this.gold);
    big.add(frame);
    const scr = new Mesh(new PlaneGeometry(9.2, 4.6), scrMat);
    scr.position.z = 0.19;
    big.add(scr);
    big.position.set(0, 6.0, -16.6);
    big.rotation.x = -0.12;
    this.group.add(big);
    this.topSign = neonMaterial(drawNeon('★ VIP SHOWDOWN ★', '#ffc23a', 1024, 256, 96), 1.5);
    const top = new Mesh(new PlaneGeometry(10, 2.5), this.topSign);
    top.position.set(0, 9.6, -16.9);
    this.group.add(top);

    // two VIP balcony tiers with gold rails, audience and table lamps
    const front = new MeshStandardMaterial({ map: balconyTexture(), roughness: 0.6, metalness: 0.2 });
    (front.map as CanvasTexture).repeat.set(5, 1);
    const deck = new MeshStandardMaterial({ color: 0x220a0e, roughness: 0.8 });
    const seats: Vector3[] = [];
    const tiers = [
      { z: -12.2, y: 1.0, w: 17, depth: 1.8 },
      { z: -14.0, y: 2.6, w: 19, depth: 1.8 },
    ];
    const railParts: BufferGeometry[] = [];
    for (const t of tiers) {
      const slab = new Mesh(new BoxGeometry(t.w, 0.3, t.depth), deck);
      slab.position.set(0, t.y - 0.15, t.z - t.depth / 2 + 0.2);
      this.group.add(slab);
      const support = new Mesh(new BoxGeometry(t.w, t.y - GROUND_Y, 0.25), deck);
      support.position.set(0, (t.y + GROUND_Y) / 2 - 0.15, t.z - t.depth + 0.3);
      this.group.add(support);
      const f = new Mesh(new BoxGeometry(t.w, 0.85, 0.16), front);
      f.position.set(0, t.y + 0.42, t.z + 0.2);
      this.group.add(f);
      railParts.push(new CylinderGeometry(0.05, 0.05, t.w, 8).rotateZ(Math.PI / 2).translate(0, t.y + 0.9, t.z + 0.22));
      for (let x = -t.w / 2 + 0.6; x < t.w / 2 - 0.4; x += rng.range(0.55, 0.85)) {
        if (rng.chance(0.82)) seats.push(new Vector3(x + rng.range(-0.1, 0.1), t.y, t.z - rng.range(0.25, 1.2)));
      }
    }
    this.group.add(new Mesh(merge(railParts), this.gold));
    this.sticks = buildCrowd(this.group, seats, [0x1a1418, 0x2a2228, 0x3a0a14, 0x4a3a28, 0x14141c, 0x262028, 0x5a0f1c, 0x30282a], [0xffd27a, 0xffffff, 0xff3a4a, 0xffb43a, 0xfff1c0], this.sh.crowd, rng, 150);
    // LED ribbon below the first tier
    const boardMat = new MeshBasicMaterial({ map: this.sh.boardTex, toneMapped: false });
    boardMat.color.setScalar(1.1);
    const board = new Mesh(new PlaneGeometry(15, 0.62), boardMat);
    board.position.set(0, 0.42, -12.02);
    this.group.add(board);

    // gold columns framing the stage
    const colParts: BufferGeometry[] = [];
    for (const [x, z] of [
      [-5.3, -11.6],
      [5.3, -11.6],
      [-10.4, -11.4],
      [10.4, -11.4],
      [-13.4, -4.6],
      [13.4, -4.6],
    ] as [number, number][]) {
      colParts.push(new CylinderGeometry(0.62, 0.7, 0.5, 14).translate(x, GROUND_Y + 0.25, z));
      colParts.push(new CylinderGeometry(0.42, 0.46, 8.2, 16).translate(x, GROUND_Y + 4.6, z));
      colParts.push(new CylinderGeometry(0.66, 0.46, 0.5, 14).translate(x, GROUND_Y + 8.9, z));
      colParts.push(new BoxGeometry(1.4, 0.24, 1.4).translate(x, GROUND_Y + 9.25, z));
    }
    const cols = new Mesh(merge(colParts), this.gold);
    cols.castShadow = false;
    this.group.add(cols);
    // fluting glow strips on the front columns
    const glowParts: BufferGeometry[] = [];
    for (const x of [-5.3, 5.3]) {
      for (let i = -1; i <= 1; i++) glowParts.push(new BoxGeometry(0.05, 7.4, 0.05).translate(x + i * 0.24, GROUND_Y + 4.6, -11.6 + 0.43));
    }
    const warm = new MeshBasicMaterial({ color: new Color(0xffd27a).multiplyScalar(1.8), toneMapped: false });
    this.group.add(new Mesh(merge(glowParts), warm));

    // side screens, gold frames
    for (const sx of [-1, 1]) {
      const s = new Group();
      s.add(new Mesh(new BoxGeometry(5.0, 2.9, 0.28), this.gold));
      const sm = new Mesh(new PlaneGeometry(4.6, 2.5), scrMat);
      sm.position.z = 0.15;
      s.add(sm);
      s.position.set(sx * 11.2, 4.4, -10.5);
      s.rotation.set(-0.12, -sx * 0.72, 0);
      this.group.add(s);
    }
    // card-suit neon signs on the side walls
    for (const sx of [-1, 1]) {
      const m = neonMaterial(drawNeon(sx < 0 ? '♠ ♥' : '♦ ♣', sx < 0 ? '#ff3a4a' : '#ffc23a', 512, 256, 150), 1.5);
      this.suitSigns.push(m);
      const p = new Mesh(new PlaneGeometry(3.6, 1.8), m);
      p.position.set(sx * 13.9, 5.2, 0.2);
      p.rotation.y = (-sx * Math.PI) / 2;
      this.group.add(p);
      const wall = new Mesh(new PlaneGeometry(24, 12), wallMat);
      wall.position.set(sx * 14.6, 5.6, -4);
      wall.rotation.y = (-sx * Math.PI) / 2;
      this.group.add(wall);
      const side = new Mesh(new PlaneGeometry(9, 10), curtain);
      side.position.set(sx * 14.4, 4.6, 6);
      side.rotation.y = (-sx * Math.PI) / 2;
      this.group.add(side);
    }
  }

  /** Gaming tables beside the ring and giant chip sculptures (decor, never in the fighting area). */
  private buildSides(): void {
    const felt = new MeshStandardMaterial({ color: 0x0f5a3a, roughness: 0.92, emissive: 0x021208 });
    const wood = new MeshStandardMaterial({ color: 0x3a1408, roughness: 0.55, metalness: 0.15 });
    const tableParts: BufferGeometry[] = [];
    const feltParts: BufferGeometry[] = [];
    const deco: BufferGeometry[] = [];
    for (const sx of [-1, 1]) {
      const x = sx * 7.9;
      const z = -1.2;
      // half-round table facing the ring
      const top = new CylinderGeometry(1.25, 1.25, 0.12, 24, 1, false, sx < 0 ? 0 : Math.PI, Math.PI);
      feltParts.push(top.translate(x, GROUND_Y + 0.92, z));
      tableParts.push(new CylinderGeometry(1.32, 1.32, 0.16, 24, 1, true, sx < 0 ? 0 : Math.PI, Math.PI).translate(x, GROUND_Y + 0.9, z));
      tableParts.push(new CylinderGeometry(0.22, 0.32, 0.86, 10).translate(x, GROUND_Y + 0.43, z));
      // little chip piles and cards on the felt
      for (let i = 0; i < 5; i++) {
        const cx = x - sx * (0.3 + (i % 3) * 0.28);
        const cz = z - 0.6 + i * 0.3;
        deco.push(tint(new CylinderGeometry(0.1, 0.1, 0.04 + (i % 3) * 0.05, 10).translate(cx, GROUND_Y + 1.0 + (i % 3) * 0.025, cz), CHIP_COLORS[i % CHIP_COLORS.length]));
      }
      for (let i = 0; i < 3; i++) deco.push(tint(new BoxGeometry(0.16, 0.01, 0.24).rotateY(i * 0.4).translate(x - sx * 0.9, GROUND_Y + 0.99, z - 0.3 + i * 0.3), 0xf4f0e8));
      // table lamp
      deco.push(tint(new CylinderGeometry(0.02, 0.02, 1.1, 6).translate(x - sx * 0.2, GROUND_Y + 1.5, z - 0.9), GOLD, 0.8));
    }
    this.group.add(new Mesh(merge(tableParts), wood));
    this.group.add(new Mesh(merge(feltParts), felt));
    const decoMat = new MeshLambertMaterial({ vertexColors: true });
    this.group.add(new Mesh(merge(deco), decoMat));
    const lampShade = new MeshBasicMaterial({ color: new Color(0xffd27a).multiplyScalar(2), toneMapped: false });
    for (const sx of [-1, 1]) {
      const lamp = new Mesh(new CylinderGeometry(0.12, 0.26, 0.2, 12), lampShade);
      lamp.position.set(sx * 7.9 - sx * 0.2, GROUND_Y + 2.1, -2.1);
      this.group.add(lamp);
    }
    // giant chip sculptures (stacks and a chip on edge), outside the corners
    const big: BufferGeometry[] = [];
    const bigSpots: [number, number, number][] = [
      [-8.6, -7.6, 3],
      [8.6, -7.6, 4],
      [-8.4, 4.8, 2],
      [8.4, 4.8, 2],
    ];
    bigSpots.forEach(([x, z, n], j) => {
      for (let i = 0; i < n; i++) {
        big.push(tint(new CylinderGeometry(0.85, 0.85, 0.24, 28).rotateY(i * 0.5).translate(x + (i % 2) * 0.06, GROUND_Y + 0.12 + i * 0.25, z), CHIP_COLORS[(i + j) % 4]));
      }
    });
    big.push(tint(new CylinderGeometry(1.2, 1.2, 0.3, 32).rotateZ(Math.PI / 2 - 0.12).rotateY(0.6).translate(-10.6, GROUND_Y + 1.15, -2.6), 0xc8102e));
    big.push(tint(new CylinderGeometry(1.2, 1.2, 0.3, 32).rotateZ(Math.PI / 2 + 0.12).rotateY(-0.6).translate(10.6, GROUND_Y + 1.15, -2.6), 0x14141a));
    this.group.add(new Mesh(merge(big), new MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.15 })));
    // gold rims of the sculptures
    const rims: BufferGeometry[] = [];
    bigSpots.forEach(([x, z, n]) => rims.push(new TorusGeometry(0.85, 0.035, 6, 32).rotateX(Math.PI / 2).translate(x, GROUND_Y + 0.25 * n, z)));
    this.group.add(new Mesh(merge(rims), this.gold));
  }

  // --------------------------------------------------------------------- props
  private buildProps(): void {
    const chipGeo = new CylinderGeometry(0.24, 0.24, 0.07, 22);
    const sideMat = new MeshStandardMaterial({ map: chipSideTexture(false), emissiveMap: chipSideTexture(true), emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.45 });
    const faceMat = new MeshStandardMaterial({ map: chipFaceTexture(false), emissiveMap: chipFaceTexture(true), emissive: 0xffffff, emissiveIntensity: 0.45, roughness: 0.45 });
    const PER = 12;
    const chipCount = DEF.props.filter((p) => p.kind === 'chips').length * PER;
    this.chips = new InstancedMesh(chipGeo, [sideMat, faceMat, faceMat], chipCount);
    this.chips.castShadow = true;
    this.group.add(this.chips);
    const baseMat = new MeshStandardMaterial({ color: 0x120a0c, roughness: 0.4, metalness: 0.4 });
    const baseGeo = new CylinderGeometry(0.62, 0.7, 0.14, 18);
    let ci = 0;
    DEF.props.forEach((p, idx) => {
      if (p.kind === 'chips') {
        const y0 = landingY(p.x, p.z);
        const base = new Mesh(baseGeo, baseMat);
        base.position.set(p.x, y0 + 0.07, p.z);
        this.group.add(base);
        const st: ChipStack = { i0: ci, n: PER, x: p.x, z: p.z, home: [], objs: [], base, broken: false, shake: 0 };
        // three columns of chips of different heights
        const cols: [number, number, number][] = [
          [-0.2, -0.1, 6],
          [0.22, -0.08, 4],
          [0.0, 0.24, 2],
        ];
        let k = 0;
        cols.forEach(([dx, dz, n], col) => {
          for (let i = 0; i < n; i++) {
            const o = new Object3D();
            o.position.set(p.x + dx + Math.sin(i * 1.7) * 0.012, y0 + 0.14 + 0.035 + i * 0.072, p.z + dz);
            o.rotation.y = i * 0.37;
            o.updateMatrix();
            st.home.push(o.matrix.clone());
            st.objs.push(o);
            this.chips.setMatrixAt(ci + k, o.matrix);
            this.chips.setColorAt(ci + k, _c.setHex(CHIP_COLORS[(col * 2 + (i >> 1)) % CHIP_COLORS.length]));
            k++;
          }
        });
        ci += PER;
        this.propMap[idx] = { k: 'chips', s: this.stacks.length };
        this.stacks.push(st);
      } else if (p.kind === 'neonSign') {
        this.propMap[idx] = { k: 'sign' };
        this.buildSign(p.x, p.z);
      } else if (p.kind === 'roulette') {
        this.propMap[idx] = { k: 'wheel', w: this.wheels.length };
        this.wheels.push(this.buildWheel(p.x, p.z));
      }
    });
    this.chips.instanceMatrix.needsUpdate = true;
    if (this.chips.instanceColor) this.chips.instanceColor.needsUpdate = true;
  }

  private buildSign(x: number, z: number): void {
    const group = new Group();
    group.position.set(x, WALL_TOP, z - 0.35);
    const boxMat = new MeshStandardMaterial({ color: 0x0c0608, roughness: 0.5, metalness: 0.4 });
    const box = new Mesh(new BoxGeometry(3.7, 0.95, 0.22), boxMat);
    box.position.y = 0.75;
    group.add(box);
    const legs = new Mesh(merge([new BoxGeometry(0.1, 0.4, 0.1).translate(-1.4, 0.15, 0), new BoxGeometry(0.1, 0.4, 0.1).translate(1.4, 0.15, 0)]), this.gold);
    group.add(legs);
    const frame = new Mesh(merge([new BoxGeometry(3.8, 0.06, 0.26).translate(0, 1.25, 0), new BoxGeometry(3.8, 0.06, 0.26).translate(0, 0.26, 0)]), this.gold);
    group.add(frame);
    const high = neonMaterial(signNeon('HIGH', '#ffc23a'), 1.7);
    const roller = neonMaterial(signNeon('ROLLER', '#ff3a5a'), 1.7);
    const hp = new Mesh(new PlaneGeometry(1.35, 0.5), high);
    hp.position.set(-1.05, 0.76, 0.12);
    group.add(hp);
    const rp = new Mesh(new PlaneGeometry(2.0, 0.6), roller);
    rp.position.set(0.75, 0.76, 0.12);
    group.add(rp);
    // bulb border
    const bulbs = new MeshBasicMaterial({ color: new Color(0xfff0c8).multiplyScalar(2.2), toneMapped: false });
    const bParts: BufferGeometry[] = [];
    for (let i = 0; i <= 18; i++) {
      const bx = -1.8 + (i / 18) * 3.6;
      bParts.push(new SphereGeometry(0.04, 6, 4).translate(bx, 1.2, 0.13));
      bParts.push(new SphereGeometry(0.04, 6, 4).translate(bx, 0.31, 0.13));
    }
    group.add(new Mesh(merge(bParts), bulbs));
    this.group.add(group);
    this.sign = { group, high, roller, bulbs, stage: 0, flicker: 0, tilt: 0 };
  }

  private buildWheel(x: number, z: number): Wheel {
    const group = new Group();
    group.position.set(x, GROUND_Y, z);
    group.rotation.y = Math.atan2(-x, -z);
    const ped = new Mesh(merge([new CylinderGeometry(0.5, 0.75, 0.9, 16).translate(0, 0.45, 0), new CylinderGeometry(0.85, 0.85, 0.12, 20).translate(0, 0.95, 0)]), this.gold);
    group.add(ped);
    // the wheel leans toward the ring so its face reads from the battle camera
    const tilt = new Group();
    tilt.position.y = 1.35;
    tilt.rotation.x = 0.85;
    group.add(tilt);
    const bowl = new Mesh(new CylinderGeometry(1.2, 1.05, 0.28, 32), new MeshStandardMaterial({ color: 0x3a1a0a, roughness: 0.4, metalness: 0.2 }));
    tilt.add(bowl);
    tilt.add(new Mesh(new TorusGeometry(1.2, 0.07, 8, 40).rotateX(Math.PI / 2).translate(0, 0.14, 0), this.gold));
    const disc = new Group();
    disc.position.y = 0.15;
    tilt.add(disc);
    const face = new Mesh(new CircleGeometry(1.08, 40), new MeshStandardMaterial({ map: rouletteTexture(), roughness: 0.35, metalness: 0.1, emissive: 0x1a0606 }));
    face.rotation.x = -Math.PI / 2;
    disc.add(face);
    const turret = new Mesh(
      merge([
        new CylinderGeometry(0.16, 0.24, 0.24, 12).translate(0, 0.12, 0),
        new BoxGeometry(0.9, 0.05, 0.06).translate(0, 0.22, 0),
        new BoxGeometry(0.06, 0.05, 0.9).translate(0, 0.22, 0),
        new SphereGeometry(0.08, 8, 6).translate(0, 0.3, 0),
      ]),
      this.gold,
    );
    disc.add(turret);
    const ball = new Mesh(new SphereGeometry(0.06, 10, 8), new MeshBasicMaterial({ color: 0xffffff }));
    ball.position.set(0.92, 0.2, 0);
    tilt.add(ball);
    this.group.add(group);
    return { group, disc, ball, speed: 0.55, ballA: 0, kick: 0 };
  }

  private buildLights(): void {
    const housing = new MeshStandardMaterial({ color: 0x1a1210, roughness: 0.4, metalness: 0.7 });
    const spots: [number, number, number, number][] = [
      [-9, -6, 0xffd27a, 0.5],
      [9, -6, 0xff3a4a, -0.5],
      [-9, 4, 0xfff1c0, 0.6],
      [9, 4, 0xffb43a, -0.6],
    ];
    for (const [x, z, col, yaw] of spots) {
      const c = makeSpotCone(x, 11, z, col, yaw, housing);
      this.group.add(c.pivot);
      this.cones.push(c);
    }
  }

  // ------------------------------------------------------------------- theming
  override applyTheme(th: ArenaTheme, isDefault: boolean): void {
    // the stock look keeps the casino's gold palette; seasons / BOSS FIGHT bring their own
    const spots = isDefault ? [0xffd27a, 0xff3a4a, 0xfff1c0, 0xffb43a] : th.spots;
    colorCones(this.cones, spots);
    colorSticks(this.sticks, isDefault ? [0xffd27a, 0xffffff, 0xff3a4a, 0xffb43a, 0xfff1c0] : th.sticks);
    this.topSign.map?.dispose();
    this.topSign.map = isDefault ? drawNeon('★ VIP SHOWDOWN ★', '#ffc23a', 1024, 256, 96) : drawNeon(`★ ${th.neon.main[0]} ★`, th.neon.main[1], 1024, 256, th.neon.main[0].length > 9 ? 92 : 104);
    this.topSign.needsUpdate = true;
  }

  override setSpots(colors: number[]): void {
    colorCones(this.cones, colors);
  }

  // ---------------------------------------------------------- set-piece events
  propHit(i: number, hp: number, heavy: boolean, x: number, z: number): void {
    const m = this.propMap[i];
    if (!m) return;
    const vfx = this.vfx;
    if (m.k === 'wheel') {
      const w = this.wheels[m.w];
      w.speed += heavy ? 7 : 2.6;
      w.kick = 1;
      vfx?.flash(w.group.position.x, 1.6, w.group.position.z, _c.set(0xffd27a), 0.4, 2.2, 0.25, 2);
      return;
    }
    if (m.k === 'sign') {
      // first hit flickers; the second knocks out "HIGH"
      const s = this.sign;
      s.stage = 3 - hp;
      s.flicker = 0.7;
      s.tilt = Math.min(0.1, s.tilt + 0.035);
      if (vfx) {
        vfx.burst(x, 1.4, z, _c.set(0xfff0c0), 16, 5, 0.1, 0.35, 2.6, 8, 1.5);
        vfx.flash(x, 1.4, z, _c.set(0xffc23a), 0.3, 1.6, 0.15, 2);
      }
      return;
    }
    const st = this.stacks[m.s];
    st.shake = 0.35;
  }

  propBreak(i: number, x: number, z: number): void {
    const m = this.propMap[i];
    if (!m) return;
    const vfx = this.vfx;
    if (m.k === 'sign') {
      const s = this.sign;
      s.stage = 3;
      s.flicker = 1.2;
      s.tilt = 0.16;
      if (vfx) {
        vfx.burst(x, 1.3, z, _c.set(0xfff0c0), 30, 7, 0.1, 0.5, 2.6, 9, 2);
        vfx.burst(x, 1.3, z, _c.set(0xff3a5a), 14, 5, 0.12, 0.4, 2.4, 8, 1);
        for (let k = 0; k < 3; k++) vfx.soft.spawn(x + (k - 1) * 0.8, 1.4, z, 0, 0.6, 0, 0.9, 0.4, 1.1, _c.set(0x3a3036), 1, 2, -0.3);
      }
      return;
    }
    if (m.k !== 'chips') return;
    const st = this.stacks[m.s];
    st.broken = true;
    // the chips burst out of the stack and scatter over the barrier and the carpet
    const ox = -x;
    const oz = -z;
    const ol = Math.hypot(ox, oz) || 1;
    st.objs.forEach((o, k) => {
      const a = (k / st.n) * Math.PI * 2 + 0.4;
      const out = 1.6 + (k % 4) * 0.5;
      const vx = Math.cos(a) * out - (ox / ol) * 1.2;
      const vz = Math.sin(a) * out - (oz / ol) * 1.2;
      const land = landingY(o.position.x + vx * 0.45, o.position.z + vz * 0.45);
      // chips are medium debris: they lie 6–8 s (staggered), then shrink away
      this.pieces.launch(o, [vx, 3.2 + (k % 3) * 0.9, vz], [6 + k, 3, 5 - k], land + 0.035, 'medium', (k % 5) / 4);
    });
    st.base.scale.set(1, 0.6, 1);
    if (vfx) {
      vfx.burst(x, 0.9, z, _c.set(0xffd27a), 22, 6, 0.12, 0.4, 2.6, 8, 2);
      vfx.flash(x, 0.9, z, _c.set(0xfff0c8), 0.4, 2.2, 0.18, 2.2);
      vfx.ring(x, z, _c.set(0xffc23a), 0.4, 2.4, 0.35, 2);
    }
  }

  resetProps(): void {
    this.pieces.clear();
    for (const st of this.stacks) {
      st.broken = false;
      st.shake = 0;
      st.base.scale.set(1, 1, 1);
      st.objs.forEach((o, k) => {
        o.matrix.copy(st.home[k]);
        o.matrix.decompose(o.position, o.quaternion, o.scale);
        this.chips.setMatrixAt(st.i0 + k, st.home[k]);
      });
    }
    this.chips.instanceMatrix.needsUpdate = true;
    const s = this.sign;
    s.stage = 0;
    s.flicker = 0;
    s.tilt = 0;
    s.group.rotation.z = 0;
    for (const w of this.wheels) {
      w.speed = 0.55;
      w.kick = 0;
    }
  }

  // ---------------------------------------------------------------------- frame
  update(dt: number, ex: number, boost: number): void {
    this.time += dt;
    const t = this.time;
    const mo = this.motion;
    swingCones(this.cones, t, ex, boost, mo);
    // marquee chase (calmer with reduced motion)
    this.bulbT -= dt;
    if (this.bulbT <= 0) {
      this.bulbT = mo > 0.5 ? 0.09 : 0.3;
      this.bulbPhase = (this.bulbPhase + 1) % 4;
      for (let i = 0; i < this.bulbCount; i++) {
        const on = (i + this.bulbPhase) % 4 !== 0;
        this.bulbs.setColorAt(i, _c.setHex(on ? 0xffe0a0 : 0x7a4a20).multiplyScalar(on ? 2.2 + boost : 1));
      }
      if (this.bulbs.instanceColor) this.bulbs.instanceColor.needsUpdate = true;
    }
    this.topSign.color.setScalar(1.45 + Math.sin(t * 2) * 0.08 + boost * 0.6);
    for (const s of this.suitSigns) s.color.setScalar(1.4 + (mo > 0.5 && Math.sin(t * 31) > 0.97 ? -0.6 : 0));

    // roulette wheels: idle drift, spin-ups decay back
    for (const w of this.wheels) {
      w.speed += (0.55 * (0.3 + 0.7 * mo) - w.speed) * Math.min(1, dt * 0.6);
      w.disc.rotation.y += w.speed * dt;
      w.ballA -= (w.speed * 1.6 + 0.4) * dt;
      w.ball.position.set(Math.cos(w.ballA) * 0.95, 0.2, Math.sin(w.ballA) * 0.95);
      w.kick = Math.max(0, w.kick - dt * 2);
      w.group.position.y = GROUND_Y + Math.sin(t * 40) * 0.02 * w.kick;
    }

    // HIGH ROLLER sign: stages of damage
    const s = this.sign;
    s.flicker = Math.max(0, s.flicker - dt);
    // fast flicker only with full motion; reduced motion: a slow pulse
    const fl = s.flicker > 0 ? (Math.sin(t * (mo > 0.5 ? 60 : 6)) > 0 ? 1 : 0.3) : 1;
    const deadBlink = mo > 0.5 && Math.sin(t * 23) > 0.96 ? 0.6 : 0.05;
    s.high.color.setScalar(s.stage >= 2 ? deadBlink : 1.7 * fl);
    s.roller.color.setScalar(s.stage >= 3 ? deadBlink * 0.5 : 1.7 * fl);
    s.bulbs.color.setScalar(s.stage >= 3 ? 0.25 : (2.2 - s.stage * 0.5) * fl);
    s.group.rotation.z += (s.tilt - s.group.rotation.z) * Math.min(1, dt * 6);

    // chip stacks: wobble on near misses, flying chips after a break
    let dirty = false;
    for (const st of this.stacks) {
      if (st.shake > 0 && !st.broken) {
        st.shake = Math.max(0, st.shake - dt);
        const wob = Math.sin(t * 50) * 0.04 * st.shake;
        st.objs.forEach((o, k) => {
          o.matrix.copy(st.home[k]);
          _m.makeRotationZ(wob * (k % 3));
          o.matrix.multiply(_m);
          this.chips.setMatrixAt(st.i0 + k, o.matrix);
        });
        dirty = true;
      }
    }
    // flying, resting or fading chips (matrices re-uploaded only when something moved)
    if (this.pieces.busy && this.pieces.update(this.debrisFrozen ? 0 : dt)) {
      for (const st of this.stacks) {
        if (!st.broken) continue;
        st.objs.forEach((o, k) => {
          o.updateMatrix();
          this.chips.setMatrixAt(st.i0 + k, o.matrix);
        });
      }
      dirty = true;
    }
    if (dirty) this.chips.instanceMatrix.needsUpdate = true;
  }
}

/** Point at distance `d` along a rounded-rect path (for bulbs that follow the barrier). */
function pointOnRing(hx: number, hz: number, r: number, d: number): Vector3 {
  const sx = 2 * (hx - r);
  const sz = 2 * (hz - r);
  const arc = (Math.PI / 2) * r;
  const segs: [number, (u: number) => Vector3][] = [
    [sx, (u) => new Vector3(-hx + r + u, 0, -hz)],
    [arc, (u) => cornerPt(hx - r, -hz + r, r, -Math.PI / 2 + u / r)],
    [sz, (u) => new Vector3(hx, 0, -hz + r + u)],
    [arc, (u) => cornerPt(hx - r, hz - r, r, u / r)],
    [sx, (u) => new Vector3(hx - r - u, 0, hz)],
    [arc, (u) => cornerPt(-hx + r, hz - r, r, Math.PI / 2 + u / r)],
    [sz, (u) => new Vector3(-hx, 0, hz - r - u)],
    [arc, (u) => cornerPt(-hx + r, -hz + r, r, Math.PI + u / r)],
  ];
  let left = d;
  for (const [len, f] of segs) {
    if (left <= len) return f(left);
    left -= len;
  }
  return new Vector3(-hx + r, 0, -hz);
}

function cornerPt(cx: number, cz: number, r: number, a: number): Vector3 {
  return new Vector3(cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r);
}

export { pointOnRing };
