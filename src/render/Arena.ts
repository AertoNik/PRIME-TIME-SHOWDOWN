import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  RepeatWrapping,
  Shape,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ARENA } from '../config/balance';
import { THEMES, type ArenaTheme, type Sponsor } from '../config/themes.config';
import { clamp01, ease, Rng } from '../core/math';
import { SeasonalDecor } from './SeasonalDecor';
import { canvasTexture, makeCanvas } from './textures';

function roundedRectShape(hx: number, hz: number, r: number): Shape {
  const s = new Shape();
  s.moveTo(-hx + r, -hz);
  s.lineTo(hx - r, -hz);
  s.absarc(hx - r, -hz + r, r, -Math.PI / 2, 0, false);
  s.lineTo(hx, hz - r);
  s.absarc(hx - r, hz - r, r, 0, Math.PI / 2, false);
  s.lineTo(-hx + r, hz);
  s.absarc(-hx + r, hz - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-hx, -hz + r);
  s.absarc(-hx + r, -hz + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

function ringShape(hx: number, hz: number, r: number, thick: number): Shape {
  const outer = roundedRectShape(hx + thick, hz + thick, r + thick);
  const inner = roundedRectShape(hx, hz, r);
  outer.holes.push(inner);
  return outer;
}

/** Extrude in XY then lay flat so +depth points up (+Y). Shape y maps to world -z. */
function flatExtrude(shape: Shape, depth: number, bevel = false): BufferGeometry {
  const g = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel,
    bevelThickness: 0.04,
    bevelSize: 0.04,
    bevelSegments: 2,
    curveSegments: 18,
  });
  g.rotateX(-Math.PI / 2);
  return g;
}

/** Colours every vertex by world z: blue on the player side, hot orange on the rival side. */
function teamGradient(g: BufferGeometry, a: Color, b: Color, intensity: number): void {
  const pos = g.getAttribute('position');
  const arr = new Float32Array(pos.count * 3);
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const t = clamp01((z + ARENA.wallZ) / (ARENA.wallZ * 2));
    c.copy(b).lerp(a, ease.inOutCubic(t)).multiplyScalar(intensity);
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new Float32BufferAttribute(arr, 3));
}

// ---------------------------------------------------------------- textures
const FLOOR_HX = ARENA.wallX + 0.4;
const FLOOR_HZ = ARENA.wallZ + 0.4;

function drawFloor(): { map: CanvasTexture; emissive: CanvasTexture } {
  const W = 1024;
  const H = Math.round((W * FLOOR_HZ) / FLOOR_HX);
  const ppu = W / (FLOOR_HX * 2);
  const { c, g } = makeCanvas(W, H);
  const e = makeCanvas(W, H);
  const eg = e.g;
  const X = (x: number) => W / 2 + x * ppu;
  const Y = (z: number) => H / 2 + z * ppu; // canvas top = far (enemy) side
  eg.fillStyle = '#000';
  eg.fillRect(0, 0, W, H);

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

  // border inset (rounded rect)
  const inset = (ctx: CanvasRenderingContext2D, hx: number, hz: number, r: number) => {
    ctx.moveTo(X(-hx + r), Y(-hz));
    ctx.lineTo(X(hx - r), Y(-hz));
    ctx.arc(X(hx - r), Y(-hz + r), r * ppu, -Math.PI / 2, 0);
    ctx.lineTo(X(hx), Y(hz - r));
    ctx.arc(X(hx - r), Y(hz - r), r * ppu, 0, Math.PI / 2);
    ctx.lineTo(X(-hx + r), Y(hz));
    ctx.arc(X(-hx + r), Y(hz - r), r * ppu, Math.PI / 2, Math.PI);
    ctx.lineTo(X(-hx), Y(-hz + r));
    ctx.arc(X(-hx + r), Y(-hz + r), r * ppu, Math.PI, Math.PI * 1.5);
    ctx.closePath();
  };
  glowLine((ctx) => inset(ctx, ARENA.wallX - 0.35, ARENA.wallZ - 0.35, ARENA.wallCorner - 0.35), 'rgba(40,230,220,0.85)', 5);

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

  const map = canvasTexture(c);
  const emissive = canvasTexture(e.c);
  return { map, emissive };
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

/** Scrolling LED ribbon: sponsors + one live broadcast segment redrawn with match data. */
function drawBoard(
  c: HTMLCanvasElement,
  live: { left: string; right: string; rating: number; mode: string },
  blink: boolean,
  sponsors: Sponsor[],
  idle: [string, string],
  accent: string,
): void {
  const g = c.getContext('2d')!;
  const W = c.width;
  const H = c.height;
  const segs = sponsors.length + 1;
  const seg = W / segs;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  sponsors.forEach((s, i) => {
    g.fillStyle = s.bg;
    g.fillRect(i * seg, 0, seg, H);
    g.fillStyle = s.fg;
    const size = Math.round(H * (s.text.length > 12 ? 0.36 : 0.5));
    g.font = `italic 900 ${size}px Unbounded, "Arial Black", sans-serif`;
    g.fillText(s.text, i * seg + seg / 2, H / 2 + 4);
  });
  // live segment
  const x0 = sponsors.length * seg;
  g.fillStyle = '#070a1c';
  g.fillRect(x0, 0, seg, H);
  g.fillStyle = blink ? '#ff2a4a' : '#7a1020';
  g.beginPath();
  g.arc(x0 + 30, H / 2, 12, 0, Math.PI * 2);
  g.fill();
  g.font = `900 ${Math.round(H * 0.34)}px Unbounded, "Arial Black", sans-serif`;
  g.textAlign = 'left';
  g.fillStyle = '#ffffff';
  if (live.mode === 'fight') {
    g.fillText(`LIVE  ${live.left} VS ${live.right}`, x0 + 52, H * 0.34);
    g.fillStyle = '#ffd23a';
    g.fillText(`★ РЕЙТИНГ ${Math.round(live.rating)}`, x0 + 52, H * 0.74);
  } else {
    g.fillText(`LIVE  ${idle[0]}`, x0 + 52, H * 0.34);
    g.fillStyle = accent;
    g.fillText(idle[1], x0 + 52, H * 0.74);
  }
  // LED dot mask
  g.fillStyle = 'rgba(0,0,0,0.35)';
  for (let y = 0; y < H; y += 6) g.fillRect(0, y, W, 2);
}

function drawNeon(text: string, color: string, w = 1024, h = 256, font = 150): CanvasTexture {
  const { c, g } = makeCanvas(w, h);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `italic 900 ${font}px Unbounded, "Arial Black", sans-serif`;
  g.shadowColor = color;
  g.shadowBlur = 30;
  g.strokeStyle = color;
  g.lineWidth = 10;
  g.strokeText(text, w / 2, h / 2);
  g.shadowBlur = 8;
  g.fillStyle = '#ffffff';
  g.fillText(text, w / 2, h / 2);
  return canvasTexture(c);
}

// ------------------------------------------------------------------- arena
export interface ScreenInfo {
  mode: 'menu' | 'fight' | 'result';
  left: string;
  right: string;
  leftColor: string;
  rightColor: string;
  rating: number;
  timer: string;
  headline: string;
}

interface PropView {
  group: Group;
  alive: boolean;
  t: number;
  lamp: MeshBasicMaterial;
}

interface Cone {
  mesh: Group;
  baseYaw: number;
  speed: number;
  phase: number;
  mat: ShaderMaterial;
  lens: MeshBasicMaterial;
}

/** The TV studio arena: floor, barrier, props, stands, crowd, screens and lights. */
export class Arena {
  readonly group = new Group();
  private crowdUniforms = { uTime: { value: 0 }, uExcite: { value: 0.2 } };
  private sticksMat: ShaderMaterial;
  private boardTex: CanvasTexture;
  private boardCanvas: HTMLCanvasElement;
  private boardTimer = 0;
  private boardBlink = false;
  private screenCanvas: HTMLCanvasElement;
  private screenCtx: CanvasRenderingContext2D;
  private screenTex: CanvasTexture;
  private screenTimer = 0;
  private screenInfo: ScreenInfo = {
    mode: 'menu',
    left: '',
    right: '',
    leftColor: '#22f0e0',
    rightColor: '#ff7a1a',
    rating: 0,
    timer: '',
    headline: 'PRIME TIME: SHOWDOWN',
  };
  private neonMats: MeshBasicMaterial[] = [];
  private theme: ArenaTheme = THEMES.default.arena;
  private sticks!: Points;
  private decor: SeasonalDecor | null = null;
  private wallGlow: MeshBasicMaterial;
  private cones: Cone[] = [];
  readonly props: PropView[] = [];
  private time = 0;
  excitement = 0.2;
  private flashBoost = 0;

  constructor() {
    this.buildFloor();
    this.buildWalls();
    this.buildProps();
    this.wallGlow = this.group.userData.wallGlow as MeshBasicMaterial;
    const crowd = this.buildStands();
    this.sticks = crowd.sticks;
    this.sticksMat = crowd.sticks.material as ShaderMaterial;
    this.boardCanvas = makeCanvas(2560, 128).c;
    this.boardTex = this.buildBoards();
    const sc = this.buildScreens();
    this.screenCanvas = sc.canvas;
    this.screenCtx = sc.ctx;
    this.screenTex = sc.tex;
    this.buildLights();
    this.drawScreen();
  }

  // ------------------------------------------------------------- floor
  private buildFloor(): void {
    const { map, emissive } = drawFloor();
    map.anisotropy = 8;
    emissive.anisotropy = 8;
    const shape = roundedRectShape(FLOOR_HX, FLOOR_HZ, ARENA.wallCorner + 0.4);
    const geo = flatExtrude(shape, 0.35, true);
    geo.translate(0, -0.35, 0);
    // planar UVs for the top cap
    const pos = geo.getAttribute('position');
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = (pos.getX(i) + FLOOR_HX) / (FLOOR_HX * 2);
      uv[i * 2 + 1] = 1 - (pos.getZ(i) + FLOOR_HZ) / (FLOOR_HZ * 2);
    }
    geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    const top = new MeshStandardMaterial({
      map,
      emissiveMap: emissive,
      emissive: new Color(1, 1, 1),
      emissiveIntensity: 1.6,
      roughness: 0.42,
      metalness: 0.25,
    });
    const side = new MeshStandardMaterial({ color: 0x0b1030, roughness: 0.5, metalness: 0.4 });
    const floor = new Mesh(geo, [top, side]);
    floor.receiveShadow = true;
    this.group.add(floor);

    // outer ground
    const ground = new Mesh(new PlaneGeometry(90, 90), new MeshStandardMaterial({ map: drawStars(), roughness: 0.9, metalness: 0 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.36;
    this.group.add(ground);
  }

  // ------------------------------------------------------------- walls
  private buildWalls(): void {
    const thick = 0.45;
    const h = 0.6;
    const wallGeo = flatExtrude(ringShape(ARENA.wallX, ARENA.wallZ, ARENA.wallCorner, thick), h, false);
    const wallMat = new MeshStandardMaterial({ color: 0x141a3c, roughness: 0.35, metalness: 0.55 });
    const wall = new Mesh(wallGeo, wallMat);
    wall.castShadow = true;
    wall.receiveShadow = true;
    this.group.add(wall);

    const capGeo = flatExtrude(ringShape(ARENA.wallX + 0.06, ARENA.wallZ + 0.06, ARENA.wallCorner + 0.06, 0.16), 0.05, false);
    capGeo.translate(0, h, 0);
    teamGradient(capGeo, new Color(0x1fd6ff), new Color(0xff4a2a), 1);
    const glowMat = new MeshBasicMaterial({ vertexColors: true });
    glowMat.color.setScalar(1.7);
    this.group.add(new Mesh(capGeo, glowMat));
    this.group.userData.wallGlow = glowMat;

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
    }
  }

  // ------------------------------------------------------------- props
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
      this.props.push({ group: g, alive: true, t: 1, lamp });
    });
  }

  breakProp(i: number): void {
    const p = this.props[i];
    if (!p) return;
    p.alive = false;
    p.group.visible = false;
  }

  respawnProp(i: number): void {
    const p = this.props[i];
    if (!p) return;
    p.alive = true;
    p.t = 0;
    p.group.visible = true;
    p.group.scale.setScalar(0.01);
  }

  // ------------------------------------------------------------ stands
  private buildStands(): { mat: MeshLambertMaterial; sticks: Points } {
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
        for (let z = -9.8; z < 6.8; z += rng.range(0.5, 0.75)) {
          if (rng.chance(0.85)) seats.push(new Vector3(x + rng.range(-0.15, 0.1), y, z));
        }
      }
    }

    // crowd geometry: body + head (+ raised arms variant)
    const body = new CapsuleGeometry(0.2, 0.32, 2, 7);
    body.translate(0, 0.38, 0);
    const head = new SphereGeometry(0.17, 8, 6);
    head.translate(0, 0.8, 0);
    const armL = new CapsuleGeometry(0.06, 0.32, 1, 4);
    armL.rotateZ(0.5);
    armL.translate(-0.25, 0.85, 0);
    const armR = armL.clone();
    armR.rotateY(Math.PI);
    const fanA = mergeGeometries([body, head])!;
    const fanB = mergeGeometries([body.clone(), head.clone(), armL, armR])!;

    const mat = new MeshLambertMaterial({ color: 0xffffff });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.crowdUniforms.uTime;
      shader.uniforms.uExcite = this.crowdUniforms.uExcite;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uExcite;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 ip = instanceMatrix[3].xyz;
            float ph = ip.x * 1.7 + ip.z * 2.3;
            float j = max(0.0, sin(uTime * (4.0 + uExcite * 5.0) + ph));
            transformed.y += j * (0.03 + uExcite * 0.24);
          #endif`,
        );
    };
    mat.customProgramCacheKey = () => 'pt-crowd';

    const palette = [0x2a2f5a, 0x3a2050, 0x1f3a52, 0x4a2a3a, 0x253050, 0x302848, 0x452a52, 0x1d2a44];
    const half = Math.floor(seats.length / 2);
    const mk = (geo: BufferGeometry, list: Vector3[]) => {
      const im = new InstancedMesh(geo, mat, list.length);
      const m = new Matrix4();
      const c = new Color();
      list.forEach((p, i) => {
        const s = rng.range(0.85, 1.12);
        m.makeScale(s, s, s);
        m.setPosition(p.x, p.y, p.z);
        im.setMatrixAt(i, m);
        c.setHex(palette[i % palette.length]).multiplyScalar(rng.range(0.8, 1.25));
        im.setColorAt(i, c);
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      this.group.add(im);
    };
    mk(fanA, seats.slice(0, half));
    mk(fanB, seats.slice(half));

    // glow sticks & phone lights over the crowd
    const n = Math.min(seats.length, 260);
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const phase = new Float32Array(n);
    const stickColors = [0x22f0e0, 0xff7a1a, 0xff4fd8, 0xffe14d, 0x7aa8ff, 0xffffff];
    const cc = new Color();
    for (let i = 0; i < n; i++) {
      const p = seats[Math.floor(rng.next() * seats.length)];
      pos[i * 3] = p.x + rng.range(-0.2, 0.2);
      pos[i * 3 + 1] = p.y + rng.range(1.0, 1.25);
      pos[i * 3 + 2] = p.z;
      cc.setHex(stickColors[i % stickColors.length]);
      col[i * 3] = cc.r;
      col[i * 3 + 1] = cc.g;
      col[i * 3 + 2] = cc.b;
      phase[i] = rng.range(0, 100);
    }
    const sg = new BufferGeometry();
    sg.setAttribute('position', new Float32BufferAttribute(pos, 3));
    sg.setAttribute('color', new Float32BufferAttribute(col, 3));
    sg.setAttribute('phase', new Float32BufferAttribute(phase, 1));
    const sm = new ShaderMaterial({
      uniforms: { uTime: this.crowdUniforms.uTime, uExcite: this.crowdUniforms.uExcite, uScale: { value: 300 } },
      vertexShader: /* glsl */ `
        attribute float phase;
        attribute vec3 color;
        uniform float uTime;
        uniform float uExcite;
        uniform float uScale;
        varying vec3 vColor;
        varying float vA;
        void main() {
          vec3 p = position;
          float ph = p.x * 1.7 + p.z * 2.3;
          p.y += max(0.0, sin(uTime * (4.0 + uExcite * 5.0) + ph)) * (0.03 + uExcite * 0.24);
          p.x += sin(uTime * 3.0 + phase) * 0.12 * uExcite;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float blink = 0.55 + 0.45 * sin(uTime * 2.0 + phase);
          vA = blink * (0.35 + uExcite * 0.9);
          vColor = color;
          gl_PointSize = uScale * (0.09 + uExcite * 0.05) / -mv.z;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vA;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d);
          float a = smoothstep(0.5, 0.0, r);
          gl_FragColor = vec4(vColor * a * vA * 2.2, 1.0);
        }`,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    const sticks = new Points(sg, sm);
    this.group.add(sticks);
    return { mat, sticks };
  }

  // ------------------------------------------------------------ boards
  private buildBoards(): CanvasTexture {
    this.paintBoard(true);
    const tex = canvasTexture(this.boardCanvas);
    tex.wrapS = RepeatWrapping;
    const mat = new MeshBasicMaterial({ map: tex, toneMapped: false });
    mat.color.setScalar(1.15);
    const north = new Mesh(new PlaneGeometry(14, 0.75), mat);
    north.position.set(0, 0.62, -ARENA.wallZ - 1.0);
    north.rotation.x = -0.35;
    this.group.add(north);
    for (const sx of [-1, 1]) {
      const side = new Mesh(new PlaneGeometry(17, 0.75), mat);
      side.position.set(sx * (ARENA.wallX + 1.25), 0.62, -1.5);
      side.rotation.set(0, -sx * Math.PI / 2, 0);
      side.rotateX(-0.45);
      this.group.add(side);
    }
    return tex;
  }

  // ----------------------------------------------------------- screens
  private buildScreens(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; tex: CanvasTexture } {
    const { c, g } = makeCanvas(1024, 512);
    const tex = canvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    const scrMat = new MeshBasicMaterial({ map: tex, toneMapped: false });
    const frameMat = new MeshStandardMaterial({ color: 0x0c1028, roughness: 0.4, metalness: 0.6 });
    const big = new Group();
    const frame = new Mesh(new BoxGeometry(10.6, 5.6, 0.4), frameMat);
    big.add(frame);
    const scr = new Mesh(new PlaneGeometry(10, 5), scrMat);
    scr.position.z = 0.21;
    big.add(scr);
    big.position.set(0, 4.6, -16.5);
    big.rotation.x = -0.18;
    this.group.add(big);
    for (const sx of [-1, 1]) {
      const s = new Group();
      s.add(new Mesh(new BoxGeometry(5.4, 3, 0.3), frameMat));
      const sm = new Mesh(new PlaneGeometry(5, 2.6), scrMat);
      sm.position.z = 0.16;
      s.add(sm);
      s.position.set(sx * 11.5, 4.2, -11);
      s.rotation.set(-0.15, -sx * 0.7, 0);
      this.group.add(s);
    }

    // neon signs (textures are swapped by applyTheme)
    const neon1 = new MeshBasicMaterial({ map: drawNeon('PRIME TIME', '#22f0e0'), transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
    neon1.color.setScalar(1.6);
    const s1 = new Mesh(new PlaneGeometry(10, 2.5), neon1);
    s1.position.set(0, 8.4, -16.8);
    this.group.add(s1);
    const neon2 = new MeshBasicMaterial({ map: drawNeon('SHOWDOWN', '#ff7a1a', 1024, 256, 130), transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
    neon2.color.setScalar(1.6);
    for (const sx of [-1, 1]) {
      const s2 = new Mesh(new PlaneGeometry(6, 1.5), neon2);
      s2.position.set(sx * 13.8, 5, -4);
      s2.rotation.y = -sx * Math.PI / 2;
      this.group.add(s2);
    }
    const live = new MeshBasicMaterial({ map: drawNeon('● ON AIR', '#ff2a4a', 1024, 256, 120), transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
    live.color.setScalar(1.6);
    const s3 = new Mesh(new PlaneGeometry(4.6, 1.15), live);
    s3.position.set(-7.6, 2.6, -9.6);
    s3.rotation.y = 0.35;
    this.group.add(s3);
    this.neonMats.push(neon1, neon2, live);
    return { canvas: c, ctx: g, tex };
  }

  setScreen(info: Partial<ScreenInfo>): void {
    Object.assign(this.screenInfo, info);
    this.decor?.setMenuVisible(this.screenInfo.mode === 'menu');
  }

  private paintBoard(blink: boolean): void {
    const si = this.screenInfo;
    const th = this.theme;
    drawBoard(this.boardCanvas, { left: si.left, right: si.right, rating: si.rating, mode: si.mode }, blink, th.sponsors, th.boardLive, th.screen.colorA);
  }

  /**
   * Re-dress the arena for a season: neon texts, LED ribbon, big-screen palette,
   * spotlights, crowd glow sticks and the seasonal decoration set. Geometry and
   * collisions stay the same; previous seasonal objects are disposed.
   */
  applyTheme(th: ArenaTheme, lowQuality: boolean): void {
    this.theme = th;
    const [main, side, live] = this.neonMats;
    const swap = (m: MeshBasicMaterial, tex: CanvasTexture) => {
      m.map?.dispose();
      m.map = tex;
      m.needsUpdate = true;
    };
    swap(main, drawNeon(th.neon.main[0], th.neon.main[1], 1024, 256, th.neon.main[0].length > 10 ? 120 : 150));
    swap(side, drawNeon(th.neon.side[0], th.neon.side[1], 1024, 256, th.neon.side[0].length > 9 ? 112 : 130));
    swap(live, drawNeon(th.neon.live[0], th.neon.live[1], 1024, 256, th.neon.live[0].length > 9 ? 96 : 120));
    this.cones.forEach((c, i) => {
      const col = th.spots[i % th.spots.length];
      (c.mat.uniforms.uColor.value as Color).setHex(col);
      c.lens.color.setHex(col).multiplyScalar(3);
    });
    const colAttr = this.sticks.geometry.getAttribute('color') as Float32BufferAttribute;
    const cc = new Color();
    for (let i = 0; i < colAttr.count; i++) {
      cc.setHex(th.sticks[i % th.sticks.length]);
      colAttr.setXYZ(i, cc.r, cc.g, cc.b);
    }
    colAttr.needsUpdate = true;
    this.paintBoard(this.boardBlink);
    this.boardTex.needsUpdate = true;
    this.drawScreen();
    this.decor?.dispose();
    this.decor = null;
    if (th.decor !== 'none' || th.ambient !== 'none') {
      this.decor = new SeasonalDecor(th.decor, th.ambient, th.ambientColors, lowQuality);
      this.decor.setMenuVisible(this.screenInfo.mode === 'menu');
      this.group.add(this.decor.group);
    }
  }

  setLowQuality(low: boolean): void {
    this.decor?.setQuality(low);
  }

  private drawScreen(): void {
    const g = this.screenCtx;
    const W = this.screenCanvas.width;
    const H = this.screenCanvas.height;
    const s = this.screenInfo;
    const th = this.theme.screen;
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, th.bgTop);
    bg.addColorStop(1, th.bgBottom);
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    // moving diagonal stripes
    g.save();
    g.globalAlpha = 0.08;
    g.fillStyle = th.colorA;
    const off = (this.time * 60) % 80;
    for (let x = -H; x < W + H; x += 80) {
      g.beginPath();
      g.moveTo(x + off, 0);
      g.lineTo(x + off + 30, 0);
      g.lineTo(x + off + 30 - H, H);
      g.lineTo(x + off - H, H);
      g.fill();
    }
    g.restore();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // LIVE tag
    g.fillStyle = '#ff2a4a';
    g.beginPath();
    g.roundRect(28, 26, 150, 52, 10);
    g.fill();
    g.fillStyle = '#fff';
    g.font = '900 30px Unbounded, "Arial Black", sans-serif';
    g.fillText(Math.floor(this.time * 2) % 2 ? '● LIVE' : '  LIVE', 103, 54);

    if (s.mode === 'menu') {
      g.font = 'italic 900 92px Unbounded, "Arial Black", sans-serif';
      g.fillStyle = '#ffffff';
      g.shadowColor = th.colorA;
      g.shadowBlur = 24;
      g.fillText(th.title, W / 2, H / 2 - 50);
      g.shadowColor = th.colorB;
      g.fillStyle = th.colorB;
      g.font = 'italic 900 72px Unbounded, "Arial Black", sans-serif';
      g.fillText(th.subtitle, W / 2, H / 2 + 50);
      g.shadowBlur = 0;
      g.font = '700 28px Rubik, Arial, sans-serif';
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.fillText(s.headline, W / 2, H - 50);
    } else {
      g.font = 'italic 900 64px Unbounded, "Arial Black", sans-serif';
      g.fillStyle = s.leftColor;
      g.shadowColor = s.leftColor;
      g.shadowBlur = 18;
      g.fillText(s.left, W * 0.27, H * 0.42);
      g.fillStyle = s.rightColor;
      g.shadowColor = s.rightColor;
      g.fillText(s.right, W * 0.73, H * 0.42);
      g.shadowBlur = 0;
      g.fillStyle = '#fff';
      g.font = 'italic 900 54px Unbounded, "Arial Black", sans-serif';
      g.fillText('VS', W / 2, H * 0.42);
      g.font = '900 40px Unbounded, "Arial Black", sans-serif';
      g.fillText(s.timer, W / 2, 54);
      // rating bar
      const bx = 160;
      const bw = W - 320;
      const by = H * 0.74;
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.beginPath();
      g.roundRect(bx, by, bw, 30, 15);
      g.fill();
      const grd = g.createLinearGradient(bx, 0, bx + bw, 0);
      grd.addColorStop(0, '#22f0e0');
      grd.addColorStop(1, '#ff7a1a');
      g.fillStyle = grd;
      g.beginPath();
      g.roundRect(bx, by, Math.max(30, (bw * s.rating) / 100), 30, 15);
      g.fill();
      g.font = '800 26px Rubik, Arial, sans-serif';
      g.fillStyle = '#fff';
      g.fillText(`РЕЙТИНГ ШОУ ${Math.round(s.rating)}`, W / 2, by + 62);
      if (th.fightHeadline) {
        g.font = 'italic 900 30px Unbounded, "Arial Black", sans-serif';
        g.fillStyle = th.colorB;
        g.fillText(th.fightHeadline, W / 2, H - 34);
      }
      if (s.headline) {
        g.font = 'italic 900 40px Unbounded, "Arial Black", sans-serif';
        g.fillStyle = '#ffe14d';
        g.fillText(s.headline, W / 2, H * 0.2);
      }
    }
    // scanlines
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
    this.screenTex.needsUpdate = true;
  }

  // ------------------------------------------------------------ lights
  private buildLights(): void {
    const coneGeo = new CylinderGeometry(0.12, 2.6, 13, 24, 1, true);
    coneGeo.translate(0, -6.5, 0);
    const spots: { x: number; z: number; color: number; yaw: number }[] = [
      { x: -9, z: -6, color: 0x22d8ff, yaw: 0.5 },
      { x: 9, z: -6, color: 0xff6a2a, yaw: -0.5 },
      { x: -9, z: 4, color: 0x7a5bff, yaw: 0.6 },
      { x: 9, z: 4, color: 0xff3df0, yaw: -0.6 },
    ];
    const housingMat = new MeshStandardMaterial({ color: 0x15182e, roughness: 0.4, metalness: 0.7 });
    for (const s of spots) {
      const mat = new ShaderMaterial({
        uniforms: { uColor: { value: new Color(s.color) }, uIntensity: { value: 0.22 } },
        vertexShader: /* glsl */ `
          varying float vH;
          varying vec3 vN;
          varying vec3 vV;
          void main() {
            vH = -position.y / 13.0;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vV = -mv.xyz;
            vN = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uIntensity;
          varying float vH;
          varying vec3 vN;
          varying vec3 vV;
          void main() {
            float edge = abs(dot(normalize(vN), normalize(vV)));
            float a = (1.0 - vH) * edge * edge * uIntensity;
            gl_FragColor = vec4(uColor * a, 1.0);
          }`,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      });
      const pivot = new Group();
      pivot.position.set(s.x, 11, s.z);
      const cone = new Mesh(coneGeo, mat);
      pivot.add(cone);
      const housing = new Mesh(new CylinderGeometry(0.35, 0.45, 0.7, 14), housingMat);
      pivot.add(housing);
      const lensMat = new MeshBasicMaterial({ color: new Color(s.color).multiplyScalar(3) });
      const lens = new Mesh(new SphereGeometry(0.32, 12, 8), lensMat);
      lens.position.y = -0.35;
      pivot.add(lens);
      this.group.add(pivot);
      this.cones.push({ mesh: pivot, baseYaw: s.yaw, speed: 0.35 + Math.random() * 0.2, phase: Math.random() * 6, mat, lens: lensMat });
    }
  }

  /** Short celebration burst (big reactions). */
  hype(amount = 1): void {
    this.flashBoost = Math.max(this.flashBoost, amount);
  }

  update(dt: number): void {
    this.time += dt;
    const t = this.time;
    this.flashBoost = Math.max(0, this.flashBoost - dt * 0.8);
    const ex = Math.min(1, this.excitement + this.flashBoost * 0.6);
    this.crowdUniforms.uTime.value = t;
    this.crowdUniforms.uExcite.value += (ex - this.crowdUniforms.uExcite.value) * Math.min(1, dt * 2);
    this.boardTex.offset.x = (t * 0.03) % 1;

    for (const c of this.cones) {
      const sp = c.speed * (1 + ex * 1.6);
      c.mesh.rotation.z = c.baseYaw + Math.sin(t * sp + c.phase) * 0.35;
      c.mesh.rotation.x = Math.cos(t * sp * 0.8 + c.phase) * 0.3;
      c.mat.uniforms.uIntensity.value = 0.14 + ex * 0.16 + this.flashBoost * 0.25;
    }
    // neon flicker
    for (let i = 0; i < this.neonMats.length; i++) {
      const m = this.neonMats[i];
      const flick = Math.sin(t * 37 + i * 11) > 0.985 ? 0.5 : 1;
      m.color.setScalar(1.5 * flick + this.flashBoost * 0.8);
    }
    this.wallGlow.color.setScalar(1.6 + Math.sin(t * 3) * 0.15 + this.flashBoost * 1.2);
    this.decor?.update(dt, ex);
    this.sticksMat.uniforms.uScale.value = 300;

    for (const p of this.props) {
      if (p.alive && p.t < 1) {
        p.t = Math.min(1, p.t + dt * 2.5);
        p.group.scale.setScalar(ease.outBack(p.t));
      }
    }

    this.boardTimer -= dt;
    if (this.boardTimer <= 0) {
      this.boardTimer = 0.5;
      this.boardBlink = !this.boardBlink;
      this.paintBoard(this.boardBlink);
      this.boardTex.needsUpdate = true;
    }
    this.screenTimer -= dt;
    if (this.screenTimer <= 0) {
      this.screenTimer = 0.25;
      this.drawScreen();
    }
  }

  dispose(): void {
    this.decor?.dispose();
    this.decor = null;
    this.group.traverse((o) => {
      const m = o as Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as Material | Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
  }
}
