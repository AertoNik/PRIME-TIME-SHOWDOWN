import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import { arenaById } from '../../config/arenas.config';
import { ARENA } from '../../config/balance';
import type { ArenaTheme } from '../../config/themes.config';
import { Rng } from '../../core/math';
import { canvasTexture } from '../textures';
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

// PRIME MOVIE BACKLOT — ACTION TAKE ONE. An action-movie street built inside a
// huge soundstage: painted asphalt with actor marks, plywood façades with their
// scaffolding showing, the studio walls and the lighting grid above, cameras with
// red tally lights, a jib crane, a dolly on its track, the director's monitors.
// Set pieces react to stray shots: prop walls split and reveal their frame, crates
// burst into planks, the clapperboard snaps shut and topples, the studio lamps
// swing, flicker and finally droop.

const DEF = arenaById('backlot');
const _c = new Color();
const FONT = 'Unbounded, "Arial Black", sans-serif';

// ------------------------------------------------------------------ textures
function drawFloor(): { map: CanvasTexture; emissive: CanvasTexture } {
  const { c, g, e, eg, X, Y, ppu, W, H } = floorCanvas(1024);
  // asphalt with grain
  g.fillStyle = '#24272e';
  g.fillRect(0, 0, W, H);
  const rng = new Rng(19);
  for (let i = 0; i < 9000; i++) {
    const v = rng.range(20, 70);
    g.fillStyle = `rgba(${v}, ${v + 3}, ${v + 10}, ${rng.range(0.15, 0.45)})`;
    g.fillRect(rng.range(0, W), rng.range(0, H), rng.range(1, 3), rng.range(1, 3));
  }
  // patched asphalt and oil stains
  for (let i = 0; i < 14; i++) {
    g.fillStyle = `rgba(10, 12, 16, ${rng.range(0.15, 0.3)})`;
    g.beginPath();
    g.ellipse(rng.range(0, W), rng.range(0, H), rng.range(20, 70), rng.range(10, 40), rng.range(0, 3), 0, Math.PI * 2);
    g.fill();
  }
  // sidewalk band inside the barrier with a curb line
  g.save();
  g.lineWidth = 0.55 * ppu;
  g.strokeStyle = '#5a5c62';
  g.beginPath();
  insetPath(g, X, Y, ppu, ARENA.wallX - 0.3, ARENA.wallZ - 0.3, ARENA.wallCorner - 0.3);
  g.stroke();
  g.lineWidth = 3;
  g.strokeStyle = '#8a8c92';
  g.beginPath();
  insetPath(g, X, Y, ppu, ARENA.wallX - 0.58, ARENA.wallZ - 0.58, ARENA.wallCorner - 0.58);
  g.stroke();
  g.restore();
  // double yellow centre line along the street
  g.fillStyle = '#d8b02a';
  for (let z = -ARENA.wallZ + 0.8; z < ARENA.wallZ - 0.8; z += 1.1) {
    if (Math.abs(z) < 1.4) continue;
    g.fillRect(X(-0.09) - 3, Y(z), 4, 0.7 * ppu);
    g.fillRect(X(0.09) - 1, Y(z), 4, 0.7 * ppu);
  }
  // crosswalk across the middle
  g.fillStyle = 'rgba(232, 232, 226, 0.85)';
  for (let x = -ARENA.wallX + 0.9; x < ARENA.wallX - 0.9; x += 0.62) g.fillRect(X(x), Y(-0.9), 0.36 * ppu, 1.8 * ppu);
  // manhole covers
  for (const [mx, mz] of [
    [-2.6, -4.2],
    [2.8, 3.6],
  ] as [number, number][]) {
    g.fillStyle = '#1a1c20';
    g.beginPath();
    g.arc(X(mx), Y(mz), 0.42 * ppu, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#3a3c42';
    g.lineWidth = 3;
    for (let r = 0.12; r < 0.42; r += 0.1) {
      g.beginPath();
      g.arc(X(mx), Y(mz), r * ppu, 0, Math.PI * 2);
      g.stroke();
    }
  }
  // actor marks in gaffer tape (blue: player, red: rival), slightly luminous
  for (const [z, col] of [
    [ARENA.halfZ - 0.6, '#3a9aff'],
    [-ARENA.halfZ + 0.6, '#ff3a3a'],
  ] as [number, string][]) {
    for (const ctx of [g, eg]) {
      ctx.save();
      ctx.fillStyle = col;
      if (ctx === eg) {
        ctx.globalAlpha = 0.55;
        ctx.shadowColor = col;
        ctx.shadowBlur = 10;
      }
      ctx.translate(X(0), Y(z));
      ctx.fillRect(-0.55 * ppu, -6, 1.1 * ppu, 12);
      ctx.fillRect(-6, z > 0 ? -6 : -0.55 * ppu, 12, 0.55 * ppu + 6);
      ctx.restore();
    }
  }
  // stencil on the asphalt
  g.save();
  g.translate(X(0), Y(2.2));
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `900 ${Math.round(ppu * 0.42)}px ${FONT}`;
  g.fillStyle = 'rgba(230, 230, 220, 0.16)';
  g.fillText('PRIME STUDIOS · STAGE 7', 0, 0);
  g.restore();
  // warm light pool from the key lamps
  const pool = eg.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, H * 0.45);
  pool.addColorStop(0, 'rgba(255, 170, 90, 0.10)');
  pool.addColorStop(1, 'rgba(255, 170, 90, 0)');
  eg.fillStyle = pool;
  eg.fillRect(0, 0, W, H);
  return { map: canvasTexture(c), emissive: canvasTexture(e) };
}

function studioFloorTexture(): CanvasTexture {
  const t = paintTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#1c2230';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 2;
    g.strokeRect(0, 0, w, h);
    g.fillStyle = 'rgba(220, 180, 40, 0.5)';
    g.fillRect(0, h - 10, w, 5);
    g.strokeStyle = 'rgba(8, 8, 10, 0.75)';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(0, 60);
    g.bezierCurveTo(80, 40, 160, 100, w, 80);
    g.stroke();
  });
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(18, 18);
  return t;
}

function hazardTexture(): CanvasTexture {
  const t = paintTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#e8b81a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#151518';
    for (let k = -w; k < w * 2; k += 32) {
      g.beginPath();
      g.moveTo(k, 0);
      g.lineTo(k + 16, 0);
      g.lineTo(k + 16 - h, h);
      g.lineTo(k - h, h);
      g.fill();
    }
  });
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(1.6, 1.6);
  return t;
}

/** Painted plywood building front for a set flat. */
function facadeTexture(kind: 'diner' | 'hotel' | 'bank'): CanvasTexture {
  return paintTexture(512, 640, (g, w, h) => {
    const wall = kind === 'diner' ? '#b8805a' : kind === 'hotel' ? '#8a5a4a' : '#c4b08a';
    g.fillStyle = wall;
    g.fillRect(0, 0, w, h);
    // brick courses / stone blocks
    g.strokeStyle = 'rgba(40, 20, 10, 0.18)';
    g.lineWidth = 2;
    const bh = kind === 'bank' ? 40 : 18;
    for (let y = 0; y < h; y += bh) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
      for (let x = (y / bh) % 2 ? 0 : 24; x < w; x += 48) {
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x, y + bh);
        g.stroke();
      }
    }
    // cornice
    g.fillStyle = 'rgba(30, 20, 15, 0.55)';
    g.fillRect(0, 0, w, 26);
    g.fillStyle = 'rgba(255, 240, 210, 0.25)';
    g.fillRect(0, 26, w, 6);
    // windows (upper floors)
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const x = 48 + col * 150;
        const y = 70 + row * 120;
        g.fillStyle = '#2a2e3a';
        g.fillRect(x, y, 110, 80);
        const lit = (row + col + kind.length) % 3 === 0;
        g.fillStyle = lit ? 'rgba(255, 200, 120, 0.9)' : 'rgba(80, 110, 160, 0.55)';
        g.fillRect(x + 6, y + 6, 98, 68);
        g.fillStyle = 'rgba(30, 20, 15, 0.6)';
        g.fillRect(x + 52, y + 6, 6, 68);
        g.fillRect(x - 6, y + 80, 122, 8);
      }
    }
    // storefront
    const sy = h - 200;
    g.fillStyle = '#1a1c24';
    g.fillRect(30, sy, w - 60, 200);
    g.fillStyle = kind === 'diner' ? 'rgba(255, 190, 110, 0.85)' : kind === 'hotel' ? 'rgba(255, 220, 150, 0.7)' : 'rgba(170, 200, 255, 0.55)';
    g.fillRect(50, sy + 70, 170, 120);
    g.fillRect(w - 220, sy + 70, 170, 120);
    g.fillStyle = '#3a2418';
    g.fillRect(w / 2 - 45, sy + 50, 90, 150);
    // awning / sign band
    g.fillStyle = kind === 'diner' ? '#c8202a' : kind === 'hotel' ? '#1a3a6a' : '#2a2a2e';
    g.fillRect(20, sy - 10, w - 40, 64);
    g.fillStyle = kind === 'bank' ? '#e8c46a' : '#fff4e0';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `italic 900 46px ${FONT}`;
    g.fillText(kind === 'diner' ? 'DINER 24' : kind === 'hotel' ? 'HOTEL ROYAL' : 'CITY BANK', w / 2, sy + 22);
  });
}

function brickPanelTexture(): CanvasTexture {
  return paintTexture(256, 192, (g, w, h) => {
    g.fillStyle = '#9a4a32';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(230, 210, 190, 0.5)';
    g.lineWidth = 3;
    for (let y = 0; y < h; y += 16) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
      for (let x = (y / 16) % 2 ? 0 : 20; x < w; x += 40) {
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x, y + 16);
        g.stroke();
      }
    }
    // a graffiti tag and a poster: it is a set, after all
    g.fillStyle = 'rgba(40, 200, 220, 0.75)';
    g.font = `italic 900 30px ${FONT}`;
    g.fillText('PT', 20, 70);
    g.fillStyle = '#e8d8b0';
    g.fillRect(150, 40, 70, 90);
    g.fillStyle = '#c8202a';
    g.fillRect(156, 46, 58, 30);
    g.fillStyle = '#1a1a1a';
    g.font = 'bold 12px Arial';
    g.fillText('WANTED', 160, 100);
  });
}

function crateTexture(): CanvasTexture {
  return paintTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#8a5a2a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(60, 30, 10, 0.4)';
    for (let y = 0; y < h; y += 21) g.fillRect(0, y, w, 2);
    g.strokeStyle = '#5a3414';
    g.lineWidth = 10;
    g.strokeRect(5, 5, w - 10, h - 10);
    g.beginPath();
    g.moveTo(8, 8);
    g.lineTo(w - 8, h - 8);
    g.stroke();
    g.fillStyle = 'rgba(20, 15, 10, 0.75)';
    g.font = 'bold 22px Arial';
    g.textAlign = 'center';
    g.fillText('PROPS', w / 2, h / 2 + 30);
  });
}

function clapperTexture(): CanvasTexture {
  return paintTexture(512, 384, (g, w, h) => {
    g.fillStyle = '#16171c';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#e8e8e8';
    g.lineWidth = 4;
    g.strokeRect(14, 14, w - 28, h - 28);
    g.beginPath();
    g.moveTo(14, 150);
    g.lineTo(w - 14, 150);
    g.moveTo(14, 260);
    g.lineTo(w - 14, 260);
    g.moveTo(w / 2, 150);
    g.lineTo(w / 2, 260);
    g.stroke();
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `italic 900 64px ${FONT}`;
    g.fillText('PRIME TIME', w / 2, 82);
    g.font = `900 30px ${FONT}`;
    g.fillText('SCENE', w / 4, 180);
    g.fillText('TAKE', (w * 3) / 4, 180);
    g.font = `900 52px ${FONT}`;
    g.fillStyle = '#ffb43a';
    g.fillText('7', w / 4, 228);
    g.fillText('1', (w * 3) / 4, 228);
    g.font = `900 32px ${FONT}`;
    g.fillStyle = '#ffffff';
    g.fillText('ACTION · TAKE ONE', w / 2, 316);
  });
}

function stripesTexture(): CanvasTexture {
  return paintTexture(256, 32, (g, w, h) => {
    g.fillStyle = '#f2f2f2';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#121216';
    for (let k = -h; k < w + h; k += 40) {
      g.beginPath();
      g.moveTo(k, 0);
      g.lineTo(k + 20, 0);
      g.lineTo(k + 20 - h, h);
      g.lineTo(k - h, h);
      g.fill();
    }
  });
}

function wallPanelTexture(): CanvasTexture {
  const t = paintTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#141a2a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#18203a';
    for (let y = 0; y < h; y += 64) for (let x = 0; x < w; x += 64) g.fillRect(x + 4, y + 4, 56, 56);
    g.fillStyle = 'rgba(255,255,255,0.03)';
    for (let i = 0; i < 40; i++) g.fillRect((i * 37) % w, (i * 53) % h, 2, 2);
  });
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

// ------------------------------------------------------------------ set pieces
interface PropWall {
  chunks: Mesh[];
  home: { p: Vector3; r: [number, number, number] }[];
  broken: boolean;
  x: number;
  z: number;
  yaw: number;
}

interface Crate {
  group: Group;
  planks: Mesh[];
  home: { p: Vector3; r: [number, number, number] }[];
  intact: Mesh[];
  broken: boolean;
}

interface Lamp {
  pivot: Group;
  head: Group;
  beam: MeshBasicMaterial;
  lens: MeshBasicMaterial;
  swing: number;
  vel: number;
  hits: number;
  flicker: number;
  baseTilt: number;
}

interface Clapper {
  group: Group;
  board: Group;
  stick: Group;
  open: number;
  snap: number;
  fallen: number;
  broken: boolean;
  idle: number;
}

const LAYOUT: DecorLayout = {
  spots: [
    [-4.3, WALL_TOP, -7.22, 0.3],
    [4.3, WALL_TOP, -7.22, 0.34],
    [-5.2, WALL_TOP, 6.31, 0.28],
    [5.2, WALL_TOP, 6.31, 0.3],
    [-7.0, GROUND_Y, -6.3, 0.5],
    [7.0, GROUND_Y, -6.3, 0.52],
    [-7.3, GROUND_Y, 5.6, 0.46],
    [7.3, GROUND_Y, 5.6, 0.46],
    [-4.2, GROUND_Y, -10.2, 0.46],
    [4.2, GROUND_Y, -10.2, 0.46],
    [-1.4, GROUND_Y, -10.4, 0.4],
    [1.4, GROUND_Y, -10.4, 0.4],
    [-10.8, GROUND_Y, -2.0, 0.5],
    [10.8, GROUND_Y, -2.0, 0.5],
    [-9.4, GROUND_Y, -12.6, 0.5],
    [9.4, GROUND_Y, -12.6, 0.5],
  ],
  menuSpots: [
    [-1.95, 0, 0.55, 0.42],
    [1.85, 0, 0.95, 0.32],
    [-1.35, 0, -1.25, 0.28],
    [1.5, 0, -1.0, 0.24],
  ],
  screens: [
    { x: 0, y: 9.4, z: -14.2, rx: 0.12, ry: 0, w: 7.6, h: 3.9, front: 0.17, size: 1.6 },
    { x: -8.6, y: 1.6, z: -8.4, rx: -0.1, ry: 0.6, w: 1.5, h: 0.95, front: 0.06, size: 0.5 },
  ],
  banners: [
    [-5.2, 7.6, -13.0, 0],
    [5.2, 7.6, -13.0, 0],
    [-11.4, 6.8, -7.6, 0.6],
    [11.4, 6.8, -7.6, -0.6],
  ],
  bats: { r: [4, 8], h: [8, 11], cx: [-6, 6], cz: [-16, -12] },
};

export class BacklotStage extends Stage {
  readonly id = 'backlot' as const;
  readonly layout = LAYOUT;
  private cones: SpotCone[] = [];
  private pieces = new Pieces();
  private walls: PropWall[] = [];
  private crates: Crate[] = [];
  private lamps: Lamp[] = [];
  private clapper!: Clapper;
  private propMap: ({ k: 'wall'; i: number } | { k: 'crate'; i: number } | { k: 'lamp'; i: number } | { k: 'clapper' })[] = [];
  private tallies: MeshBasicMaterial[] = [];
  private onAir!: MeshBasicMaterial;
  private action!: MeshBasicMaterial;
  private crane!: Group;
  private dolly!: Group;
  private wood!: Material;

  constructor(shared: StageShared) {
    super(shared);
    this.wood = new MeshStandardMaterial({ color: 0xb08a5a, roughness: 0.8 });
    this.buildFloor();
    this.buildBarrier();
    this.buildStudio();
    this.buildFacades();
    this.buildCrew();
    this.buildProps();
    this.buildLights();
  }

  private buildFloor(): void {
    const { map, emissive } = drawFloor();
    this.group.add(floorMesh(map, emissive, { roughness: 0.85, metalness: 0.05, emissiveIntensity: 1 }, 0x15171c));
    const ground = new Mesh(new PlaneGeometry(90, 90), new MeshStandardMaterial({ map: studioFloorTexture(), roughness: 0.75, metalness: 0.1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = GROUND_Y;
    this.group.add(ground);
  }

  /** Concrete curb with yellow-black safety stripes on top and street bollards. */
  private buildBarrier(): void {
    const concrete = new MeshStandardMaterial({ color: 0x6a6d74, roughness: 0.92, metalness: 0.02 });
    const wall = new Mesh(flatExtrude(ringShape(ARENA.wallX, ARENA.wallZ, ARENA.wallCorner, 0.45), WALL_TOP), concrete);
    wall.castShadow = true;
    wall.receiveShadow = true;
    this.group.add(wall);
    const cap = flatExtrude(ringShape(ARENA.wallX + 0.03, ARENA.wallZ + 0.03, ARENA.wallCorner + 0.03, 0.39), 0.05);
    cap.translate(0, WALL_TOP, 0);
    this.group.add(new Mesh(cap, new MeshStandardMaterial({ map: hazardTexture(), roughness: 0.7 })));
    // bollards with reflective bands and red studio tally lights
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
    const steel: BufferGeometry[] = [];
    const bands: BufferGeometry[] = [];
    for (const [x, z] of posts) {
      steel.push(new CylinderGeometry(0.16, 0.18, 1.15, 12).translate(x, 0.57, z));
      bands.push(new CylinderGeometry(0.17, 0.17, 0.12, 12).translate(x, 0.9, z));
    }
    this.group.add(new Mesh(merge(steel), new MeshStandardMaterial({ color: 0x2a2e36, roughness: 0.4, metalness: 0.7 })));
    this.group.add(new Mesh(merge(bands), new MeshBasicMaterial({ color: new Color(0xff5a2a).multiplyScalar(1.5) })));
    for (const [x, z] of posts) {
      const tally = new MeshBasicMaterial({ color: new Color(0xff2020).multiplyScalar(2.5), toneMapped: false });
      const t = new Mesh(new SphereGeometry(0.1, 10, 8), tally);
      t.position.set(x, 1.2, z);
      this.group.add(t);
      this.tallies.push(tally);
    }
  }

  /** Soundstage walls, the lighting grid, the playback screen and signs. */
  private buildStudio(): void {
    const panel = new MeshStandardMaterial({ map: wallPanelTexture(), roughness: 0.95 });
    (panel.map as CanvasTexture).repeat.set(10, 4);
    const back = new Mesh(new PlaneGeometry(42, 16), panel);
    back.position.set(0, 7.6, -19.2);
    this.group.add(back);
    for (const sx of [-1, 1]) {
      const side = new Mesh(new PlaneGeometry(34, 16), panel);
      side.position.set(sx * 16.4, 7.6, -3);
      side.rotation.y = (-sx * Math.PI) / 2;
      this.group.add(side);
    }
    // giant stage number painted on the back wall
    const stage = new Mesh(
      new PlaneGeometry(12, 4),
      new MeshBasicMaterial({
        map: paintTexture(768, 256, (g, w, h) => {
          g.fillStyle = 'rgba(0,0,0,0)';
          g.clearRect(0, 0, w, h);
          g.fillStyle = 'rgba(230, 210, 170, 0.5)';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.font = `900 120px ${FONT}`;
          g.fillText('STAGE 7', w / 2, h / 2 - 10);
          g.font = `900 34px ${FONT}`;
          g.fillText('PRIME TIME STUDIOS', w / 2, h - 30);
        }),
        transparent: true,
        depthWrite: false,
      }),
    );
    stage.position.set(-9.5, 11.5, -19.1);
    this.group.add(stage);
    // lighting grid: trusses across the stage with hanging lamps
    const truss: BufferGeometry[] = [];
    const steelMat = new MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.45, metalness: 0.8 });
    const addTruss = (z: number, y: number, len: number) => {
      for (const dy of [0, 0.5]) for (const dz of [-0.25, 0.25]) truss.push(new CylinderGeometry(0.04, 0.04, len, 6).rotateZ(Math.PI / 2).translate(0, y + dy, z + dz));
      for (let x = -len / 2; x <= len / 2; x += 0.6) {
        truss.push(new CylinderGeometry(0.025, 0.025, 0.72, 4).rotateZ(0.8).translate(x, y + 0.25, z - 0.25));
        truss.push(new CylinderGeometry(0.025, 0.025, 0.72, 4).rotateZ(-0.8).translate(x, y + 0.25, z + 0.25));
      }
    };
    addTruss(-12.6, 11.2, 28);
    addTruss(-4, 12.2, 28);
    addTruss(5, 12.2, 28);
    for (const sx of [-1, 1]) truss.push(new CylinderGeometry(0.03, 0.03, 4, 4).translate(sx * 3.8, 10.6, -14.2));
    this.group.add(new Mesh(merge(truss), steelMat));
    const lampParts: BufferGeometry[] = [];
    const lensParts: BufferGeometry[] = [];
    for (const z of [-12.6, -4, 5]) {
      for (let x = -12; x <= 12; x += 3) {
        const y = z === -12.6 ? 10.7 : 11.7;
        lampParts.push(new CylinderGeometry(0.22, 0.28, 0.45, 10).translate(x, y, z));
        lensParts.push(new CylinderGeometry(0.2, 0.2, 0.04, 10).translate(x, y - 0.24, z));
      }
    }
    this.group.add(new Mesh(merge(lampParts), new MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.5, metalness: 0.6 })));
    this.group.add(new Mesh(merge(lensParts), new MeshBasicMaterial({ color: new Color(0xffc890).multiplyScalar(2.2), toneMapped: false })));

    // playback screen hanging from the grid (the live broadcast)
    const scr = new Group();
    scr.add(new Mesh(new BoxGeometry(7.6, 3.9, 0.3), new MeshStandardMaterial({ color: 0x101218, roughness: 0.4, metalness: 0.5 })));
    const sm = new Mesh(new PlaneGeometry(7.2, 3.6), new MeshBasicMaterial({ map: this.sh.screenTex, toneMapped: false }));
    sm.position.z = 0.16;
    scr.add(sm);
    scr.position.set(0, 9.4, -14.2);
    scr.rotation.x = 0.12;
    this.group.add(scr);
    // ACTION · TAKE ONE marquee and the ON AIR light box
    this.action = neonMaterial(drawNeon('ACTION · TAKE ONE', '#ff9a3a', 1024, 256, 92), 1.5);
    const act = new Mesh(new PlaneGeometry(9, 2.2), this.action);
    act.position.set(6.8, 13.4, -12.9);
    this.group.add(act);
    this.onAir = neonMaterial(drawNeon('● ON AIR', '#ff2a3a', 1024, 256, 120), 1.6);
    const oa = new Mesh(new PlaneGeometry(4.2, 1.05), this.onAir);
    oa.position.set(-7.4, 8.2, -15.4);
    this.group.add(oa);
    const quiet = new Mesh(new PlaneGeometry(3.4, 0.85), neonMaterial(drawNeon('QUIET ON SET', '#ffd27a', 1024, 256, 100), 1.2));
    quiet.position.set(13.2, 6.4, -6);
    quiet.rotation.y = -Math.PI / 2;
    this.group.add(quiet);
  }

  /** Three plywood building flats behind the north barrier, with their scaffolding showing. */
  private buildFacades(): void {
    const kinds: ['diner' | 'hotel' | 'bank', number, number][] = [
      ['hotel', -6.4, 7.6],
      ['diner', 0, 6.4],
      ['bank', 6.4, 7.0],
    ];
    const scaffold: BufferGeometry[] = [];
    for (const [kind, x, hgt] of kinds) {
      const mat = new MeshStandardMaterial({ map: facadeTexture(kind), roughness: 0.85, side: DoubleSide });
      const f = new Mesh(new PlaneGeometry(6.2, hgt), mat);
      f.position.set(x, GROUND_Y + hgt / 2, -11.2);
      this.group.add(f);
      // the back of the flat: battens, diagonal braces and sandbags
      const bz = -11.45;
      for (let bx = x - 2.9; bx <= x + 2.95; bx += 1.45) scaffold.push(new BoxGeometry(0.1, hgt, 0.1).translate(bx, GROUND_Y + hgt / 2, bz));
      for (let by = 1; by < hgt; by += 2.2) scaffold.push(new BoxGeometry(6.1, 0.1, 0.1).translate(x, GROUND_Y + by, bz));
      for (const s of [-1, 1]) {
        const brace = new BoxGeometry(0.1, hgt * 0.9, 0.1);
        brace.rotateX(-0.42);
        scaffold.push(brace.translate(x + s * 2.2, GROUND_Y + hgt * 0.42, bz - hgt * 0.19));
      }
    }
    const scaff = new Mesh(merge(scaffold), this.wood);
    this.group.add(scaff);
    const bags: BufferGeometry[] = [];
    for (const [, x, hgt] of kinds) for (const s of [-1, 1]) bags.push(tint(new SphereGeometry(0.3, 8, 6).scale(1.3, 0.55, 0.8).translate(x + s * 2.2, GROUND_Y + 0.15, -11.45 - hgt * 0.38), 0x6a5a3a));
    // a fire escape on the hotel
    const fire: BufferGeometry[] = [];
    for (let i = 0; i < 3; i++) {
      fire.push(tint(new BoxGeometry(1.6, 0.06, 0.6).translate(-7.4, 2.2 + i * 1.8, -10.85), 0x2a2a30));
      fire.push(tint(new BoxGeometry(1.6, 0.04, 0.04).translate(-7.4, 3.0 + i * 1.8, -10.58), 0x2a2a30));
      const st = new BoxGeometry(0.4, 0.04, 1.9);
      st.rotateX(1.1);
      fire.push(tint(st.translate(-7.0, 1.3 + i * 1.8, -10.85), 0x2a2a30));
    }
    this.group.add(new Mesh(merge([...bags, ...fire]), new MeshLambertMaterial({ vertexColors: true })));
    // diner neon above its door
    const diner = new Mesh(new PlaneGeometry(2.6, 0.9), neonMaterial(drawNeon('EAT', '#ff3a5a', 512, 192, 120), 1.5));
    diner.position.set(0, 2.7, -11.05);
    this.group.add(diner);
    // LED ribbon at the foot of the flats
    const boardMat = new MeshBasicMaterial({ map: this.sh.boardTex, toneMapped: false });
    boardMat.color.setScalar(1.05);
    const board = new Mesh(new PlaneGeometry(14, 0.6), boardMat);
    board.position.set(0, 0.25, -10.4);
    board.rotation.x = -0.3;
    this.group.add(board);
  }

  /** Cameras, the dolly track, the jib crane, light stands and video village. */
  private buildCrew(): void {
    const dark = new MeshStandardMaterial({ color: 0x1c1f26, roughness: 0.45, metalness: 0.6 });
    const camGeo = (): BufferGeometry =>
      merge([
        new BoxGeometry(0.45, 0.4, 0.8).translate(0, 0, 0),
        new CylinderGeometry(0.13, 0.16, 0.4, 12).rotateX(Math.PI / 2).translate(0, 0, 0.55),
        new BoxGeometry(0.3, 0.22, 0.25).translate(0, 0.28, -0.2),
      ]);
    // pedestal cameras on both sides, aimed at the ring
    for (const [x, z] of [
      [-7.6, 1.8],
      [7.6, -4.6],
    ] as [number, number][]) {
      const g = new Group();
      g.position.set(x, GROUND_Y, z);
      g.add(new Mesh(merge([new CylinderGeometry(0.06, 0.06, 1.5, 6).translate(0, 0.75, 0), new CylinderGeometry(0.5, 0.5, 0.12, 12).translate(0, 0.06, 0)]), dark));
      const cam = new Mesh(camGeo(), dark);
      cam.position.y = 1.65;
      cam.rotation.y = Math.atan2(-x, -z);
      g.add(cam);
      const tally = new MeshBasicMaterial({ color: new Color(0xff2020).multiplyScalar(2.6), toneMapped: false });
      const t = new Mesh(new SphereGeometry(0.06, 8, 6), tally);
      t.position.set(0, 1.98, 0);
      g.add(t);
      this.tallies.push(tally);
      this.group.add(g);
    }
    // dolly track along the west side and a camera on the dolly
    const rails: BufferGeometry[] = [];
    for (const dx of [-0.35, 0.35]) rails.push(new BoxGeometry(0.06, 0.06, 11).translate(-6.9 + dx, GROUND_Y + 0.06, -3.4));
    for (let z = -8.6; z <= 1.8; z += 0.8) rails.push(new BoxGeometry(0.9, 0.05, 0.12).translate(-6.9, GROUND_Y + 0.025, z));
    this.group.add(new Mesh(merge(rails), new MeshStandardMaterial({ color: 0x8a8c94, roughness: 0.3, metalness: 0.8 })));
    this.dolly = new Group();
    this.dolly.position.set(-6.9, GROUND_Y, -3);
    this.dolly.add(new Mesh(merge([new BoxGeometry(0.9, 0.18, 1.1).translate(0, 0.2, 0), new CylinderGeometry(0.07, 0.07, 1.0, 6).translate(0, 0.75, 0)]), dark));
    const dcam = new Mesh(camGeo(), dark);
    dcam.position.y = 1.35;
    dcam.rotation.y = Math.PI / 2;
    this.dolly.add(dcam);
    this.group.add(this.dolly);
    // jib crane at the east-back corner, its arm sweeping over the set
    const base = new Group();
    base.position.set(9.0, GROUND_Y, -9.2);
    base.add(new Mesh(merge([new CylinderGeometry(0.7, 0.9, 0.3, 14).translate(0, 0.15, 0), new CylinderGeometry(0.14, 0.18, 3.2, 8).translate(0, 1.9, 0)]), dark));
    this.crane = new Group();
    this.crane.position.y = 3.5;
    const arm = new Mesh(merge([new BoxGeometry(6.4, 0.16, 0.16).translate(-1.8, 0, 0), new BoxGeometry(0.6, 0.6, 0.6).translate(1.6, -0.1, 0)]), dark);
    this.crane.add(arm);
    const jcam = new Mesh(camGeo(), dark);
    jcam.position.set(-4.9, -0.35, 0);
    jcam.rotation.y = Math.PI / 2;
    jcam.rotation.x = 0.4;
    this.crane.add(jcam);
    base.add(this.crane);
    this.group.add(base);
    // light stands with softboxes
    const soft = new MeshBasicMaterial({ color: new Color(0xfff2dc).multiplyScalar(1.7), toneMapped: false, side: DoubleSide });
    for (const [x, z, yaw] of [
      [-8.6, -5.4, 1.0],
      [8.4, 2.8, -1.4],
    ] as [number, number, number][]) {
      const g = new Group();
      g.position.set(x, GROUND_Y, z);
      g.rotation.y = yaw;
      g.add(new Mesh(merge([new CylinderGeometry(0.03, 0.03, 2.6, 5).translate(0, 1.3, 0), new ConeGeometry(0.5, 0.3, 3).translate(0, 0.15, 0)]), dark));
      const box = new Mesh(new BoxGeometry(1.1, 0.8, 0.4), dark);
      box.position.set(0, 2.7, 0);
      g.add(box);
      const face = new Mesh(new PlaneGeometry(1.0, 0.72), soft);
      face.position.set(0, 2.7, 0.21);
      g.add(face);
      this.group.add(g);
    }
    // video village: director's monitors on a cart and the director's chair
    const cart = new Group();
    cart.position.set(-8.6, GROUND_Y, -8.4);
    cart.rotation.y = 0.6;
    cart.add(new Mesh(merge([new BoxGeometry(1.7, 0.9, 0.7).translate(0, 0.45, 0), new BoxGeometry(0.06, 0.6, 0.06).translate(0, 1.2, 0)]), dark));
    const monMat = new MeshBasicMaterial({ map: this.sh.screenTex, toneMapped: false });
    for (const dx of [-0.42, 0.42]) {
      const mon = new Mesh(new BoxGeometry(0.8, 0.52, 0.08), dark);
      mon.position.set(dx, 1.6, 0);
      cart.add(mon);
      const s = new Mesh(new PlaneGeometry(0.72, 0.44), monMat);
      s.position.set(dx, 1.6, 0.05);
      cart.add(s);
    }
    this.group.add(cart);
    const chair = new Group();
    chair.position.set(-7.6, GROUND_Y, -9.6);
    chair.rotation.y = 0.5;
    chair.add(new Mesh(merge([new BoxGeometry(0.6, 0.06, 0.5).translate(0, 0.75, 0), new BoxGeometry(0.05, 0.75, 0.05).translate(-0.27, 0.37, 0.22), new BoxGeometry(0.05, 0.75, 0.05).translate(0.27, 0.37, 0.22), new BoxGeometry(0.05, 0.75, 0.05).translate(-0.27, 0.37, -0.22), new BoxGeometry(0.05, 0.75, 0.05).translate(0.27, 0.37, -0.22)]), this.wood));
    const back = new Mesh(
      new PlaneGeometry(0.62, 0.3),
      new MeshBasicMaterial({
        map: paintTexture(256, 128, (g, w, h) => {
          g.fillStyle = '#16161a';
          g.fillRect(0, 0, w, h);
          g.fillStyle = '#fff';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.font = `900 34px ${FONT}`;
          g.fillText('DIRECTOR', w / 2, h / 2);
        }),
        side: DoubleSide,
      }),
    );
    back.position.set(0, 1.15, -0.24);
    chair.add(back);
    this.group.add(chair);
  }

  // --------------------------------------------------------------------- props
  private buildProps(): void {
    const brick = new MeshStandardMaterial({ map: brickPanelTexture(), roughness: 0.85 });
    const crateMat = new MeshStandardMaterial({ map: crateTexture(), roughness: 0.8 });
    DEF.props.forEach((p, idx) => {
      if (p.kind === 'propWall') {
        this.propMap[idx] = { k: 'wall', i: this.walls.length };
        this.walls.push(this.buildPropWall(p.x, p.z, brick));
      } else if (p.kind === 'crate') {
        this.propMap[idx] = { k: 'crate', i: this.crates.length };
        this.crates.push(this.buildCrate(p.x, p.z, crateMat));
      } else if (p.kind === 'spotlight') {
        this.propMap[idx] = { k: 'lamp', i: this.lamps.length };
        this.lamps.push(this.buildLamp(p.x, p.z));
      } else if (p.kind === 'clapper') {
        this.propMap[idx] = { k: 'clapper' };
        this.clapper = this.buildClapper(p.x, p.z);
      }
    });
  }

  /** A painted brick flat on the barrier: four panels in front of a wooden frame. */
  private buildPropWall(x: number, z: number, mat: Material): PropWall {
    const yaw = Math.atan2(-x, -z);
    const y0 = landingY(x, z);
    const frame = new Group();
    frame.position.set(x, y0, z);
    frame.rotation.y = yaw;
    // the frame behind (stays when the panels are gone: the set reveals its construction)
    const parts: BufferGeometry[] = [];
    for (const fx of [-0.85, 0, 0.85]) parts.push(new BoxGeometry(0.08, 1.35, 0.08).translate(fx, 0.67, -0.14));
    for (const fy of [0.05, 0.7, 1.32]) parts.push(new BoxGeometry(1.8, 0.08, 0.08).translate(0, fy, -0.14));
    const brace = new BoxGeometry(0.07, 1.5, 0.07);
    brace.rotateZ(0.9);
    parts.push(brace.translate(0, 0.68, -0.18));
    const foot = new BoxGeometry(0.08, 0.08, 0.6);
    parts.push(foot.clone().translate(-0.8, 0.04, -0.4), foot.translate(0.8, 0.04, -0.4));
    frame.add(new Mesh(merge(parts), this.wood));
    this.group.add(frame);
    // four plywood panels, each showing its quarter of the painting
    const chunks: Mesh[] = [];
    const home: PropWall['home'] = [];
    for (let i = 0; i < 4; i++) {
      const cx = i % 2;
      const cy = i >> 1;
      const g = new BoxGeometry(0.88, 0.66, 0.05);
      const uv = g.getAttribute('uv');
      for (let k = 0; k < uv.count; k++) uv.setXY(k, (cx + uv.getX(k)) / 2, (cy + uv.getY(k)) / 2);
      const m = new Mesh(g, mat);
      m.castShadow = true;
      const local = new Vector3(cx ? 0.44 : -0.44, cy ? 1.0 : 0.34, -0.06);
      const world = local.clone().applyAxisAngle(new Vector3(0, 1, 0), yaw).add(new Vector3(x, y0, z));
      m.position.copy(world);
      m.rotation.set(0, yaw, 0);
      this.group.add(m);
      chunks.push(m);
      home.push({ p: world.clone(), r: [0, yaw, 0] });
    }
    return { chunks, home, broken: false, x, z, yaw };
  }

  private buildCrate(x: number, z: number, mat: Material): Crate {
    const y0 = landingY(x, z);
    const group = new Group();
    group.position.set(x, y0, z);
    group.rotation.y = Math.atan2(-x, -z) + 0.25;
    const big = new Mesh(new BoxGeometry(0.75, 0.75, 0.75), mat);
    big.position.y = 0.375;
    big.castShadow = true;
    const small = new Mesh(new BoxGeometry(0.5, 0.5, 0.5), mat);
    small.position.set(0.05, 1.0, 0.04);
    small.rotation.y = 0.4;
    small.castShadow = true;
    group.add(big, small);
    this.group.add(group);
    // planks used when it bursts (hidden until then)
    const planks: Mesh[] = [];
    const home: Crate['home'] = [];
    for (let i = 0; i < 7; i++) {
      const m = new Mesh(new BoxGeometry(i < 4 ? 0.75 : 0.5, 0.06, 0.16), mat);
      m.visible = false;
      this.group.add(m);
      planks.push(m);
      home.push({ p: new Vector3(x, y0 + 0.2 + i * 0.12, z), r: [0, i * 0.7, 0] });
    }
    return { group, planks, home, intact: [big, small], broken: false };
  }

  /** Studio Fresnel lamp on a stand behind a barrier corner, aimed into the ring. */
  private buildLamp(x: number, z: number): Lamp {
    const dark = new MeshStandardMaterial({ color: 0x22252c, roughness: 0.4, metalness: 0.7 });
    const pivot = new Group();
    pivot.position.set(x * 1.12, GROUND_Y, z * 1.08);
    pivot.rotation.y = Math.atan2(-x, -z);
    pivot.add(
      new Mesh(
        merge([new CylinderGeometry(0.04, 0.05, 2.4, 6).translate(0, 1.2, 0), new CylinderGeometry(0.03, 0.03, 0.9, 4).rotateZ(0.9).translate(0.3, 0.3, 0), new CylinderGeometry(0.03, 0.03, 0.9, 4).rotateZ(-0.9).translate(-0.3, 0.3, 0), new CylinderGeometry(0.03, 0.03, 0.9, 4).rotateX(0.9).translate(0, 0.3, -0.3)]),
        dark,
      ),
    );
    const head = new Group();
    head.position.y = 2.45;
    const baseTilt = 0.55;
    head.rotation.x = baseTilt;
    head.add(new Mesh(merge([new CylinderGeometry(0.26, 0.3, 0.55, 12).rotateX(Math.PI / 2), new BoxGeometry(0.62, 0.05, 0.05).translate(0, 0.32, 0)]), dark));
    const lens = new MeshBasicMaterial({ color: new Color(0xfff0d0).multiplyScalar(3), toneMapped: false });
    const l = new Mesh(new CylinderGeometry(0.24, 0.24, 0.03, 12).rotateX(Math.PI / 2), lens);
    l.position.z = 0.29;
    head.add(l);
    // its light beam (additive, short so it never washes over the fighters)
    const beamGeo = new CylinderGeometry(0.22, 1.1, 3.2, 16, 1, true);
    beamGeo.rotateX(Math.PI / 2);
    beamGeo.translate(0, 0, 1.9);
    const beam = new MeshBasicMaterial({ color: new Color(0xffd8a0).multiplyScalar(0.35), transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
    head.add(new Mesh(beamGeo, beam));
    pivot.add(head);
    this.group.add(pivot);
    return { pivot, head, beam, lens, swing: 0, vel: 0, hits: 0, flicker: 0, baseTilt };
  }

  private buildClapper(x: number, z: number): Clapper {
    const group = new Group();
    group.position.set(x, WALL_TOP, z - 0.25);
    const dark = new MeshStandardMaterial({ color: 0x1a1a20, roughness: 0.5, metalness: 0.5 });
    group.add(new Mesh(merge([new BoxGeometry(0.08, 0.6, 0.08).translate(-0.6, 0.3, -0.05), new BoxGeometry(0.08, 0.6, 0.08).translate(0.6, 0.3, -0.05)]), dark));
    const board = new Group();
    board.position.y = 0.55;
    const slate = new Mesh(new BoxGeometry(1.9, 1.35, 0.08), new MeshStandardMaterial({ map: clapperTexture(), roughness: 0.6 }));
    slate.position.y = 0.68;
    slate.castShadow = true;
    board.add(slate);
    // the clap stick, hinged at its left end
    const stick = new Group();
    stick.position.set(-0.95, 1.42, 0);
    const stripes = new MeshStandardMaterial({ map: stripesTexture(), roughness: 0.5 });
    const top = new Mesh(new BoxGeometry(1.9, 0.18, 0.09), stripes);
    top.position.x = 0.95;
    stick.add(top);
    board.add(stick);
    const fixed = new Mesh(new BoxGeometry(1.9, 0.14, 0.09), stripes);
    fixed.position.y = 1.32;
    board.add(fixed);
    group.add(board);
    this.group.add(group);
    return { group, board, stick, open: 0.35, snap: 0, fallen: 0, broken: false, idle: 6 };
  }

  private buildLights(): void {
    const housing = new MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.4, metalness: 0.7 });
    const spots: [number, number, number, number][] = [
      [-9, -6, 0xffc890, 0.5],
      [9, -6, 0x6a9aff, -0.5],
      [-9, 4, 0x6a9aff, 0.6],
      [9, 4, 0xffc890, -0.6],
    ];
    for (const [x, z, col, yaw] of spots) {
      const c = makeSpotCone(x, 11.5, z, col, yaw, housing, 0.18);
      this.group.add(c.pivot);
      this.cones.push(c);
    }
  }

  override applyTheme(th: ArenaTheme, isDefault: boolean): void {
    // tungsten and moonlight beams normally; the season / BOSS FIGHT recolours them
    colorCones(this.cones, isDefault ? [0xffc890, 0x6a9aff, 0x6a9aff, 0xffc890] : th.spots);
    this.action.map?.dispose();
    this.action.map = isDefault ? drawNeon('ACTION · TAKE ONE', '#ff9a3a', 1024, 256, 92) : drawNeon(`${th.neon.main[0]} · TAKE ONE`, th.neon.main[1], 1024, 256, 78);
    this.action.needsUpdate = true;
  }

  override setSpots(colors: number[]): void {
    colorCones(this.cones, colors);
  }

  // ---------------------------------------------------------- set-piece events
  propHit(i: number, _hp: number, heavy: boolean, x: number, z: number): void {
    const m = this.propMap[i];
    if (!m || m.k !== 'lamp') return;
    const L = this.lamps[m.i];
    L.hits++;
    // the lamp jerks round on its stand and flickers; the third knock leaves it drooping
    L.vel += (heavy ? 7 : 4.5) * (L.hits % 2 ? 1 : -1);
    L.flicker = L.hits >= 3 ? 1.6 : 0.6;
    const vfx = this.vfx;
    if (vfx) {
      const hp = L.head.getWorldPosition(new Vector3());
      vfx.burst(hp.x, hp.y, hp.z, _c.set(0xfff0c0), heavy ? 22 : 14, 6, 0.09, 0.4, 2.6, 9, 1.5);
      vfx.flash(hp.x, hp.y, hp.z, _c.set(0xffd8a0), 0.3, 1.4, 0.12, 1.8);
    }
    void x;
    void z;
  }

  propBreak(i: number, x: number, z: number): void {
    const m = this.propMap[i];
    if (!m) return;
    const vfx = this.vfx;
    const ox = -x;
    const oz = -z;
    const ol = Math.hypot(ox, oz) || 1;
    const back = [(-ox / ol) * 1.8, (-oz / ol) * 1.8];
    if (m.k === 'wall') {
      const w = this.walls[m.i];
      w.broken = true;
      w.chunks.forEach((c, k) => {
        const side = k % 2 ? 1 : -1;
        const tx = Math.cos(w.yaw) * side * 1.1;
        const tz = -Math.sin(w.yaw) * side * 1.1;
        const land = landingY(c.position.x + back[0] * 0.5, c.position.z + back[1] * 0.5);
        // plywood chunks are large debris: ~10 s on the set, then shrink away (the frame stays)
        this.pieces.launch(c, [back[0] + tx, 2.6 + (k >> 1) * 1.4, back[1] + tz], [2 + k, 1.5 * side, 3 * side], land + 0.03, 'large', k / 3);
      });
      if (vfx) {
        for (let k = 0; k < 6; k++) vfx.soft.spawn(x + (k - 2.5) * 0.25, 0.9, z, (k - 2.5) * 0.4, 0.8, 0, 1.1, 0.5, 1.6, _c.set(0x9a8a78), 1, 2.4, -0.25);
        vfx.debrisBurst(x, 0.9, z, _c.set(0x9a4a32), 8);
        vfx.dust(x, z, 10);
      }
    } else if (m.k === 'crate') {
      const c = this.crates[m.i];
      c.broken = true;
      c.intact.forEach((b) => (b.visible = false));
      c.planks.forEach((p, k) => {
        p.visible = true;
        p.position.copy(c.home[k].p);
        p.rotation.set(...c.home[k].r);
        const a = (k / c.planks.length) * Math.PI * 2;
        const land = landingY(p.position.x + Math.cos(a) * 0.8, p.position.z + Math.sin(a) * 0.8);
        // planks are medium debris: 6–8 s on the set, then shrink away
        this.pieces.launch(p, [Math.cos(a) * 2.2 + back[0] * 0.6, 3 + (k % 3), Math.sin(a) * 2.2 + back[1] * 0.6], [5, 2 + k, 4], land + 0.03, 'medium', k / (c.planks.length - 1));
      });
      if (vfx) {
        vfx.debrisBurst(x, 0.8, z, _c.set(0x8a5a2a), 10);
        vfx.dust(x, z, 12);
        vfx.burst(x, 0.8, z, _c.set(0xffd8a0), 12, 4, 0.12, 0.35, 2, 6, 1);
      }
    } else if (m.k === 'clapper') {
      const cl = this.clapper;
      cl.broken = true;
      cl.snap = 0.18;
      if (vfx) {
        vfx.flash(x, 1.8, z, _c.set(0xffffff), 0.4, 2.4, 0.15, 2.4);
        for (let k = 0; k < 4; k++) vfx.soft.spawn(x + (k - 1.5) * 0.4, 1.6, z, 0, 0.5, 0, 1, 0.4, 1.3, _c.set(0xd8d8e0), 1, 2, -0.2);
      }
    }
  }

  resetProps(): void {
    this.pieces.clear();
    for (const w of this.walls) {
      w.broken = false;
      w.chunks.forEach((c, k) => {
        c.position.copy(w.home[k].p);
        c.rotation.set(...w.home[k].r);
      });
    }
    for (const c of this.crates) {
      c.broken = false;
      c.intact.forEach((b) => (b.visible = true));
      c.planks.forEach((p) => (p.visible = false));
    }
    for (const L of this.lamps) {
      L.swing = 0;
      L.vel = 0;
      L.hits = 0;
      L.flicker = 0;
    }
    const cl = this.clapper;
    cl.broken = false;
    cl.snap = 0;
    cl.fallen = 0;
    cl.open = 0.35;
    cl.board.rotation.x = 0;
    cl.stick.rotation.z = cl.open;
  }

  // ---------------------------------------------------------------------- frame
  update(dt: number, ex: number, boost: number): void {
    this.time += dt;
    const t = this.time;
    const mo = this.motion;
    swingCones(this.cones, t, ex * 0.6, boost, mo * 0.5);
    // camera tally lights blink in turn; ON AIR breathes
    for (let i = 0; i < this.tallies.length; i++) {
      const on = Math.floor(t * 1.2 + i * 0.7) % 3 !== 0;
      this.tallies[i].color.setHex(0xff2020).multiplyScalar(on ? 2.6 : 0.4);
    }
    this.onAir.color.setScalar(1.3 + Math.sin(t * 3) * 0.3 + boost * 0.6);
    this.action.color.setScalar(1.4 + boost * 0.5);
    // crane sweep and dolly travel (slower / smaller with reduced motion)
    this.crane.rotation.y = Math.sin(t * 0.22) * 0.6 * (0.3 + 0.7 * mo) + 0.6;
    this.crane.rotation.z = Math.sin(t * 0.31) * 0.12 * mo;
    this.dolly.position.z = -3.4 + Math.sin(t * 0.18) * 4.2 * (0.3 + 0.7 * mo);

    // studio lamps: spring back from knocks, flicker, droop after the third
    for (const L of this.lamps) {
      L.vel += (-L.swing * 26 - L.vel * 3.2) * dt;
      L.swing += L.vel * dt;
      const droop = L.hits >= 3 ? 0.55 : 0;
      L.head.rotation.y = L.swing * 0.5;
      L.head.rotation.x = L.baseTilt + droop + Math.abs(L.swing) * 0.15;
      L.flicker = Math.max(0, L.flicker - dt);
      const broken = L.hits >= 3;
      // fast flicker only with full motion; reduced motion: a slow pulse
      const on = L.flicker > 0 ? Math.sin(t * (mo > 0.5 ? 70 : 6)) > 0 : broken ? Math.sin(t * (mo > 0.5 ? 9 : 2)) > 0.7 : true;
      L.beam.color.setHex(0xffd8a0).multiplyScalar(on ? (broken ? 0.18 : 0.35) : 0.03);
      L.lens.color.setHex(0xfff0d0).multiplyScalar(on ? (broken ? 1.4 : 3) : 0.3);
    }

    // clapperboard: an idle clap now and then; when broken it snaps shut and topples back
    const cl = this.clapper;
    if (!cl.broken) {
      cl.idle -= dt;
      if (cl.idle <= 0 && mo > 0) {
        cl.idle = 7 + (t % 3);
        cl.snap = 0.12;
      }
      if (cl.snap > 0) {
        cl.snap -= dt;
        cl.stick.rotation.z = cl.snap > 0.06 ? 0 : cl.open * (1 - cl.snap / 0.06);
      } else cl.stick.rotation.z += (cl.open - cl.stick.rotation.z) * Math.min(1, dt * 3);
    } else {
      cl.snap = Math.max(0, cl.snap - dt);
      cl.stick.rotation.z = 0;
      if (cl.snap <= 0 && cl.fallen < 1) {
        cl.fallen = Math.min(1, cl.fallen + dt * 2.4);
        cl.board.rotation.x = -(cl.fallen * cl.fallen) * 1.45;
      }
    }

    if (this.pieces.busy) this.pieces.update(this.debrisFrozen ? 0 : dt);
  }
}
