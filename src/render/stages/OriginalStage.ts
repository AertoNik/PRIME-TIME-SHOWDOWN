import {
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  Vector3,
  type Points,
} from 'three';
import { ARENA } from '../../config/balance';
import type { ArenaTheme } from '../../config/themes.config';
import { ease, Rng } from '../../core/math';
import { canvasTexture, makeCanvas } from '../textures';
import {
  buildCrowd,
  colorCones,
  colorSticks,
  drawNeon,
  flatExtrude,
  floorCanvas,
  floorMesh,
  FLOOR_HX,
  FLOOR_HZ,
  insetPath,
  makeSpotCone,
  mergeStatic,
  neonMaterial,
  ringShape,
  Stage,
  swingCones,
  teamGradient,
  type DecorLayout,
  type SpotCone,
  type StageShared,
} from './StageKit';

// ORIGINAL PRIME ARENA — the studio of Alpha 1.0–1.3 (moved here unchanged in
// Alpha 1.4): neon floor, team-coloured barrier, LED speaker stacks, stands with
// a bouncing crowd, LED ribbons, the big screens, neon signs and four spotlights.

const _c = new Color();

function drawFloor(): { map: CanvasTexture; emissive: CanvasTexture } {
  const { c, g, e, eg, X, Y, ppu, W, H } = floorCanvas(1024);

  const base = g.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, H * 0.65);
  base.addColorStop(0, '#1c2554');
  base.addColorStop(0.55, '#121a40');
  base.addColorStop(1, '#0a0f28');
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);

  // tile grid with bevel
  for (let x = -FLOOR_HX; x <= FLOOR_HX; x += 1) {
    g.fillStyle = 'rgba(5,8,24,0.55)';
    g.fillRect(X(x) - 1.5, 0, 3, H);
    g.fillStyle = 'rgba(70,90,170,0.12)';
    g.fillRect(X(x) + 1.5, 0, 1.5, H);
  }
  for (let z = -FLOOR_HZ; z <= FLOOR_HZ; z += 1) {
    g.fillStyle = 'rgba(5,8,24,0.55)';
    g.fillRect(0, Y(z) - 1.5, W, 3);
    g.fillStyle = 'rgba(70,90,170,0.12)';
    g.fillRect(0, Y(z) + 1.5, W, 1.5);
  }
  // alternating tile tint
  const rng = new Rng(7);
  for (let x = -6; x < 6; x++) {
    for (let z = -8; z < 8; z++) {
      if ((x + z) % 2 === 0) {
        g.fillStyle = 'rgba(60,80,170,0.05)';
        g.fillRect(X(x) + 2, Y(z) + 2, ppu - 4, ppu - 4);
      }
      if (rng.chance(0.25)) {
        g.fillStyle = `rgba(0,0,0,${rng.range(0.04, 0.12)})`;
        g.beginPath();
        g.ellipse(X(x + rng.next()), Y(z + rng.next()), rng.range(6, 30), rng.range(2, 6), rng.range(0, 3), 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  const glowLine = (draw: (ctx: CanvasRenderingContext2D) => void, color: string, width: number, glowColor?: string) => {
    for (const ctx of [g, eg]) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      if (ctx === eg) {
        ctx.shadowColor = glowColor ?? color;
        ctx.shadowBlur = width * 3;
      }
      ctx.beginPath();
      draw(ctx);
      ctx.stroke();
      ctx.restore();
    }
  };

  glowLine((ctx) => insetPath(ctx, X, Y, ppu, ARENA.wallX - 0.35, ARENA.wallZ - 0.35, ARENA.wallCorner - 0.35), 'rgba(40,230,220,0.85)', 5);

  // midfield line
  g.save();
  g.setLineDash([22, 16]);
  g.strokeStyle = 'rgba(255,255,255,0.22)';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(X(-ARENA.wallX + 0.4), Y(0));
  g.lineTo(X(ARENA.wallX - 0.4), Y(0));
  g.stroke();
  g.restore();

  // centre logo rings
  glowLine((ctx) => ctx.arc(X(0), Y(0), 2.25 * ppu, 0, Math.PI * 2), 'rgba(40,230,220,0.9)', 7);
  glowLine((ctx) => ctx.arc(X(0), Y(0), 1.85 * ppu, 0, Math.PI * 2), 'rgba(255,122,26,0.9)', 4);
  g.save();
  g.translate(X(0), Y(0));
  const disc = g.createRadialGradient(0, 0, 0, 0, 0, 1.85 * ppu);
  disc.addColorStop(0, 'rgba(255,255,255,0.08)');
  disc.addColorStop(1, 'rgba(255,255,255,0.02)');
  g.fillStyle = disc;
  g.beginPath();
  g.arc(0, 0, 1.85 * ppu, 0, Math.PI * 2);
  g.fill();
  g.rotate(-0.08);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `italic 900 ${Math.round(ppu * 0.62)}px Unbounded, "Arial Black", sans-serif`;
  g.fillStyle = 'rgba(255,255,255,0.16)';
  g.fillText('PRIME', 0, -ppu * 0.32);
  g.fillStyle = 'rgba(255,140,40,0.2)';
  g.fillText('TIME', 0, ppu * 0.36);
  g.restore();

  // team arcs near spawns
  glowLine((ctx) => ctx.arc(X(0), Y(ARENA.halfZ + 0.6), 2.4 * ppu, Math.PI * 1.08, Math.PI * 1.92), 'rgba(60,170,255,0.9)', 6);
  glowLine((ctx) => ctx.arc(X(0), Y(-ARENA.halfZ - 0.6), 2.4 * ppu, Math.PI * 0.08, Math.PI * 0.92), 'rgba(255,70,60,0.9)', 6);

  // corner chevrons
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const cx = X(sx * (ARENA.wallX - 1.6));
      const cz = Y(sz * (ARENA.wallZ - 1.6));
      g.save();
      g.translate(cx, cz);
      g.rotate(Math.atan2(sz, sx));
      g.fillStyle = 'rgba(255,255,255,0.08)';
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.moveTo(-10 + i * 18, -16);
        g.lineTo(4 + i * 18, 0);
        g.lineTo(-10 + i * 18, 16);
        g.lineTo(-4 + i * 18, 16);
        g.lineTo(10 + i * 18, 0);
        g.lineTo(-4 + i * 18, -16);
        g.fill();
      }
      g.restore();
    }
  }

  return { map: canvasTexture(c), emissive: canvasTexture(e) };
}

function drawStars(): CanvasTexture {
  const { c, g } = makeCanvas(512, 512);
  g.fillStyle = '#05060f';
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = 'rgba(60,80,160,0.18)';
  g.lineWidth = 2;
  for (let i = 0; i <= 512; i += 32) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 512);
    g.stroke();
    g.beginPath();
    g.moveTo(0, i);
    g.lineTo(512, i);
    g.stroke();
  }
  const t = canvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(10, 10);
  return t;
}

interface PropView {
  group: Group;
  alive: boolean;
  t: number;
}

// Barrier corners (on the wall cap), the gaps between barrier and side stands, and the stands.
const ORIGINAL_LAYOUT: DecorLayout = {
  spots: [
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
  ],
  menuSpots: [
    [-1.95, 0, 0.55, 0.42],
    [1.85, 0, 0.95, 0.32],
    [-1.35, 0, -1.25, 0.28],
    [1.5, 0, -1.0, 0.24],
  ],
  screens: [
    { x: 0, y: 4.6, z: -16.5, rx: -0.18, ry: 0, w: 10.6, h: 5.6, front: 0.23, size: 2.3 },
    { x: -11.5, y: 4.2, z: -11, rx: -0.15, ry: 0.7, w: 5.4, h: 3, front: 0.18, size: 1.3 },
    { x: 11.5, y: 4.2, z: -11, rx: -0.15, ry: -0.7, w: 5.4, h: 3, front: 0.18, size: 1.3 },
  ],
  banners: [
    [-7.6, 6.6, -15.6, 0],
    [7.6, 6.6, -15.6, 0],
    [-13.6, 6, -8.2, 0.75],
    [13.6, 6, -8.2, -0.75],
  ],
  bats: { r: [4, 9], h: [6.5, 10], cx: [-6, 6], cz: [-15, -11] },
  trees: [
    [-7.3, -0.36, -4.2, 1.1],
    [7.3, -0.36, -3.6, 1.15],
    [-7.2, -0.36, 1.2, 0.9],
    [7.25, -0.36, 1.9, 0.95],
    [-10.5, 0.3, -9.4, 1],
    [10.4, 0.3, -9.4, 1],
  ],
};

export class OriginalStage extends Stage {
  readonly id = 'original' as const;
  readonly layout = ORIGINAL_LAYOUT;
  private neonMats: MeshBasicMaterial[] = [];
  private cones: SpotCone[] = [];
  private sticks!: Points;
  private wallGlow!: MeshBasicMaterial;
  private props: PropView[] = [];
  /** 1.9.1: set pieces that never move — merged per material once the set is built (fewer draw calls). */
  private statics: Mesh[] = [];

  constructor(shared: StageShared) {
    super(shared);
    this.buildFloor();
    this.buildWalls();
    this.buildProps();
    this.buildStands();
    this.buildBoards();
    this.buildScreens();
    this.buildLights();
    mergeStatic(this.group, this.statics);
    this.statics = [];
  }

  private buildFloor(): void {
    const { map, emissive } = drawFloor();
    this.group.add(floorMesh(map, emissive, { roughness: 0.42, metalness: 0.25 }, 0x0b1030));
    const ground = new Mesh(new PlaneGeometry(90, 90), new MeshStandardMaterial({ map: drawStars(), roughness: 0.9, metalness: 0 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.36;
    this.group.add(ground);
  }

  private buildWalls(): void {
    const thick = 0.45;
    const h = 0.6;
    const wall = new Mesh(flatExtrude(ringShape(ARENA.wallX, ARENA.wallZ, ARENA.wallCorner, thick), h, false), new MeshStandardMaterial({ color: 0x141a3c, roughness: 0.35, metalness: 0.55 }));
    wall.castShadow = true;
    wall.receiveShadow = true;
    this.group.add(wall);

    const capGeo = flatExtrude(ringShape(ARENA.wallX + 0.06, ARENA.wallZ + 0.06, ARENA.wallCorner + 0.06, 0.16), 0.05, false);
    capGeo.translate(0, h, 0);
    teamGradient(capGeo, new Color(0x1fd6ff), new Color(0xff4a2a), 1);
    const glowMat = new MeshBasicMaterial({ vertexColors: true });
    glowMat.color.setScalar(1.7);
    this.group.add(new Mesh(capGeo, glowMat));
    this.wallGlow = glowMat;

    const stripGeo = flatExtrude(ringShape(ARENA.wallX - 0.01, ARENA.wallZ - 0.01, ARENA.wallCorner - 0.01, 0.02), 0.05, false);
    stripGeo.translate(0, 0.14, 0);
    teamGradient(stripGeo, new Color(0x2a7dff), new Color(0xff2a5a), 1);
    this.group.add(new Mesh(stripGeo, glowMat));

    // posts with glowing caps at the straight-wall midpoints and corners
    const postGeo = new CylinderGeometry(0.26, 0.3, 1.25, 16);
    const postMat = new MeshStandardMaterial({ color: 0x1b2148, roughness: 0.3, metalness: 0.7 });
    const capMatA = new MeshBasicMaterial({ color: new Color(0x22e8ff).multiplyScalar(3) });
    const capMatB = new MeshBasicMaterial({ color: new Color(0xff5a2a).multiplyScalar(3) });
    const capG = new CylinderGeometry(0.2, 0.2, 0.14, 16);
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
    for (const [x, z] of posts) {
      const p = new Mesh(postGeo, postMat);
      p.position.set(x, 0.62, z);
      p.castShadow = true;
      this.group.add(p);
      const cap = new Mesh(capG, z > 0.1 ? capMatA : z < -0.1 ? capMatB : x < 0 ? capMatA : capMatB);
      cap.position.set(x, 1.3, z);
      this.group.add(cap);
      this.statics.push(p, cap);
    }
  }

  private buildProps(): void {
    const bodyGeo = new BoxGeometry(0.9, 0.95, 0.6);
    const bodyMat = new MeshStandardMaterial({ color: 0x2c3570, roughness: 0.45, metalness: 0.35 });
    const coneGeo = new CylinderGeometry(0.2, 0.14, 0.06, 18);
    coneGeo.rotateX(Math.PI / 2);
    const coneMat = new MeshStandardMaterial({ color: 0x07080f, roughness: 0.7 });
    const trimGeo = new BoxGeometry(0.92, 0.06, 0.62);
    ARENA.props.forEach((p) => {
      const g = new Group();
      g.position.set(p.x, 0, p.z);
      // face toward arena centre
      g.rotation.y = Math.atan2(-p.x, -p.z);
      const body = new Mesh(bodyGeo, bodyMat);
      body.position.y = 0.48;
      body.castShadow = true;
      g.add(body);
      const lampColor = new Color(p.z > 0 ? 0x22d8ff : p.z < -0.1 ? 0xff5a2a : 0xff3df0);
      const lamp = new MeshBasicMaterial({ color: lampColor.clone().multiplyScalar(1.6) });
      const trim = new Mesh(trimGeo, lamp);
      trim.position.y = 0.97;
      g.add(trim);
      for (const y of [0.32, 0.68]) {
        const cone = new Mesh(coneGeo, coneMat);
        cone.position.set(0, y, 0.31);
        g.add(cone);
        const ring = new Mesh(new CylinderGeometry(0.21, 0.21, 0.02, 18, 1, true), lamp);
        ring.rotation.x = Math.PI / 2;
        ring.position.set(0, y, 0.33);
        g.add(ring);
      }
      this.group.add(g);
      this.props.push({ group: g, alive: true, t: 1 });
    });
  }

  private buildStands(): void {
    const standMat = new MeshStandardMaterial({ color: 0x10142e, roughness: 0.75, metalness: 0.2 });
    const railMat = new MeshBasicMaterial({ color: new Color(0x6a4bff).multiplyScalar(1.8) });
    const seats: Vector3[] = [];
    const rng = new Rng(42);
    // north stands
    for (let i = 0; i < 6; i++) {
      const z = -9.2 - i * 1.15;
      const y = 0.3 + i * 0.55;
      const w = 20 + i * 2;
      const step = new Mesh(new BoxGeometry(w, y + 0.36, 1.15), standMat);
      step.position.set(0, (y - 0.36) / 2, z);
      step.receiveShadow = true;
      this.group.add(step);
      const rail = new Mesh(new BoxGeometry(w, 0.04, 0.04), railMat);
      rail.position.set(0, y + 0.02, z + 0.56);
      this.group.add(rail);
      this.statics.push(step, rail);
      for (let x = -w / 2 + 0.6; x < w / 2 - 0.4; x += rng.range(0.5, 0.75)) {
        if (rng.chance(0.88)) seats.push(new Vector3(x + rng.range(-0.1, 0.1), y, z + rng.range(-0.15, 0.1)));
      }
    }
    // side stands
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const x = sx * (8.6 + i * 1.15);
        const y = 0.3 + i * 0.55;
        const len = 17;
        const step = new Mesh(new BoxGeometry(1.15, y + 0.36, len), standMat);
        step.position.set(x, (y - 0.36) / 2, -1.5);
        step.receiveShadow = true;
        this.group.add(step);
        const rail = new Mesh(new BoxGeometry(0.04, 0.04, len), railMat);
        rail.position.set(x - sx * 0.56, y + 0.02, -1.5);
        this.group.add(rail);
        this.statics.push(step, rail);
        for (let z = -9.8; z < 6.8; z += rng.range(0.5, 0.75)) {
          if (rng.chance(0.85)) seats.push(new Vector3(x + rng.range(-0.15, 0.1), y, z));
        }
      }
    }
    const palette = [0x2a2f5a, 0x3a2050, 0x1f3a52, 0x4a2a3a, 0x253050, 0x302848, 0x452a52, 0x1d2a44];
    this.sticks = buildCrowd(this.group, seats, palette, [0x22f0e0, 0xff7a1a, 0xff4fd8, 0xffe14d, 0x7aa8ff, 0xffffff], this.sh.crowd, rng);
  }

  private buildBoards(): void {
    const mat = new MeshBasicMaterial({ map: this.sh.boardTex, toneMapped: false });
    mat.color.setScalar(1.15);
    const north = new Mesh(new PlaneGeometry(14, 0.75), mat);
    north.position.set(0, 0.62, -ARENA.wallZ - 1.0);
    north.rotation.x = -0.35;
    this.group.add(north);
    this.statics.push(north);
    for (const sx of [-1, 1]) {
      const side = new Mesh(new PlaneGeometry(17, 0.75), mat);
      side.position.set(sx * (ARENA.wallX + 1.25), 0.62, -1.5);
      side.rotation.set(0, (-sx * Math.PI) / 2, 0);
      side.rotateX(-0.45);
      this.group.add(side);
      this.statics.push(side);
    }
  }

  private buildScreens(): void {
    const scrMat = new MeshBasicMaterial({ map: this.sh.screenTex, toneMapped: false });
    const frameMat = new MeshStandardMaterial({ color: 0x0c1028, roughness: 0.4, metalness: 0.6 });
    const big = new Group();
    const bigFrame = new Mesh(new BoxGeometry(10.6, 5.6, 0.4), frameMat);
    big.add(bigFrame);
    const scr = new Mesh(new PlaneGeometry(10, 5), scrMat);
    scr.position.z = 0.21;
    big.add(scr);
    big.position.set(0, 4.6, -16.5);
    big.rotation.x = -0.18;
    this.group.add(big);
    this.statics.push(bigFrame, scr);
    for (const sx of [-1, 1]) {
      const s = new Group();
      const frame = new Mesh(new BoxGeometry(5.4, 3, 0.3), frameMat);
      s.add(frame);
      const sm = new Mesh(new PlaneGeometry(5, 2.6), scrMat);
      sm.position.z = 0.16;
      s.add(sm);
      s.position.set(sx * 11.5, 4.2, -11);
      s.rotation.set(-0.15, -sx * 0.7, 0);
      this.group.add(s);
      this.statics.push(frame, sm);
    }

    // neon signs (textures are swapped by applyTheme)
    const neon1 = neonMaterial(drawNeon('PRIME TIME', '#22f0e0'));
    const s1 = new Mesh(new PlaneGeometry(10, 2.5), neon1);
    s1.position.set(0, 8.4, -16.8);
    this.group.add(s1);
    const neon2 = neonMaterial(drawNeon('SHOWDOWN', '#ff7a1a', 1024, 256, 130));
    for (const sx of [-1, 1]) {
      const s2 = new Mesh(new PlaneGeometry(6, 1.5), neon2);
      s2.position.set(sx * 13.8, 5, -4);
      s2.rotation.y = (-sx * Math.PI) / 2;
      this.group.add(s2);
      this.statics.push(s2);
    }
    const live = neonMaterial(drawNeon('● ON AIR', '#ff2a4a', 1024, 256, 120));
    const s3 = new Mesh(new PlaneGeometry(4.6, 1.15), live);
    s3.position.set(-7.6, 2.6, -9.6);
    s3.rotation.y = 0.35;
    this.group.add(s3);
    this.neonMats.push(neon1, neon2, live);
  }

  private buildLights(): void {
    const spots: { x: number; z: number; color: number; yaw: number }[] = [
      { x: -9, z: -6, color: 0x22d8ff, yaw: 0.5 },
      { x: 9, z: -6, color: 0xff6a2a, yaw: -0.5 },
      { x: -9, z: 4, color: 0x7a5bff, yaw: 0.6 },
      { x: 9, z: 4, color: 0xff3df0, yaw: -0.6 },
    ];
    const housingMat = new MeshStandardMaterial({ color: 0x15182e, roughness: 0.4, metalness: 0.7 });
    for (const s of spots) {
      const cone = makeSpotCone(s.x, 11, s.z, s.color, s.yaw, housingMat);
      this.group.add(cone.pivot);
      this.cones.push(cone);
    }
  }

  override applyTheme(th: ArenaTheme): void {
    const [main, side, live] = this.neonMats;
    const swap = (m: MeshBasicMaterial, tex: CanvasTexture) => {
      m.map?.dispose();
      m.map = tex;
      m.needsUpdate = true;
    };
    swap(main, drawNeon(th.neon.main[0], th.neon.main[1], 1024, 256, th.neon.main[0].length > 10 ? 120 : 150));
    swap(side, drawNeon(th.neon.side[0], th.neon.side[1], 1024, 256, th.neon.side[0].length > 9 ? 112 : 130));
    swap(live, drawNeon(th.neon.live[0], th.neon.live[1], 1024, 256, th.neon.live[0].length > 9 ? 96 : 120));
    colorCones(this.cones, th.spots);
    colorSticks(this.sticks, th.sticks);
  }

  override setSpots(colors: number[]): void {
    colorCones(this.cones, colors);
  }

  propHit(): void {
    // speaker stacks break on the first hit
  }

  propBreak(i: number, x: number, z: number): void {
    const p = this.props[i];
    if (p) {
      p.alive = false;
      p.group.visible = false;
    }
    const vfx = this.vfx;
    if (!vfx) return;
    const col = z < 0 ? _c.set(0xff5a2a) : _c.set(0x22d8ff);
    vfx.debrisBurst(x, 0.5, z, new Color(0x1a1f3d), 10);
    vfx.debrisBurst(x, 0.9, z, col, 5);
    vfx.flash(x, 0.8, z, col, 1, 3, 0.3, 3);
    vfx.burst(x, 0.8, z, col, 30, 7, 0.16, 0.5, 2.4, 8, 2);
  }

  override propRespawn(i: number, x: number, z: number): void {
    const p = this.props[i];
    if (!p) return;
    p.alive = true;
    p.t = 0;
    p.group.visible = true;
    p.group.scale.setScalar(0.01);
    this.vfx?.ring(x, z, _c.set(0x22f0e0), 0.3, 2, 0.4, 2);
  }

  resetProps(): void {
    for (const p of this.props) {
      p.alive = true;
      p.t = 1;
      p.group.visible = true;
      p.group.scale.setScalar(1);
    }
  }

  update(dt: number, ex: number, boost: number): void {
    this.time += dt;
    const t = this.time;
    swingCones(this.cones, t, ex, boost, this.motion);
    // neon flicker
    for (let i = 0; i < this.neonMats.length; i++) {
      const m = this.neonMats[i];
      const flick = Math.sin(t * 37 + i * 11) > 0.985 ? 0.5 : 1;
      m.color.setScalar(1.5 * flick + boost * 0.8);
    }
    this.wallGlow.color.setScalar(1.6 + Math.sin(t * 3) * 0.15 + boost * 1.2);
    for (const p of this.props) {
      if (p.alive && p.t < 1) {
        p.t = Math.min(1, p.t + dt * 2.5);
        p.group.scale.setScalar(ease.outBack(p.t));
      }
    }
  }
}
