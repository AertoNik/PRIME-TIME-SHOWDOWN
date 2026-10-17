import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  OctahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  PlaneGeometry,
  Shape,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Texture,
} from 'three';
import { CARD_TUNING } from '../config/balance';
import { TAKE_CARDS } from '../config/cards';
import { lineReach } from '../combat/CombatSystem';
import type { FighterSim } from '../combat/FighterSim';
import type { Match } from '../combat/Match';
import type { StageKind, StageObject } from '../combat/types';
import { clamp01, lerp } from '../core/math';
import { THROW_RELEASE } from './FighterAnimator';
import { toonRamp } from './materials';
import { canvasTexture, glowTexture, makeCanvas, ringTexture } from './textures';

// Alpha 1.6 — CARD REVOLUTION: the 3D side of the new cards. Every set piece is drawn
// straight from the simulation state (Match.objects, fighter timers) each frame, from a
// small pool of reusable meshes: nothing is created per frame, nothing outlives the
// fight (an object that leaves the simulation fades out in ~0.3 s, `reset()` hides the rest).

const COL = {
  echo: 0xc08cff,
  net: 0x4dffd2,
  mine: 0xff4a6e,
  mineArm: 0xffb02a,
  barrier: 0x6ec8ff,
  warn: 0xffb02a,
  warnHot: 0xff3a2a,
  cam: 0xff3a4a,
  freeze: 0xa6f0ff,
  tag: 0xfff0b0,
  cable: 0xe9ff70,
  frame: 0xc6ff4d,
};

const texCache = new Map<string, Texture>();
function tex(key: string, size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, h = size): Texture {
  let t = texCache.get(key);
  if (!t) {
    const { c, g } = makeCanvas(size, h);
    draw(g, size);
    t = canvasTexture(c);
    texCache.set(key, t);
  }
  return t;
}

/** GRAVITY NET: a glowing geometric floor net (rim, rings, spokes, nodes). */
const netTexture = () =>
  tex('card-net', 256, (g, s) => {
    const c = s / 2;
    g.translate(c, c);
    const grd = g.createRadialGradient(0, 0, 10, 0, 0, c);
    grd.addColorStop(0, 'rgba(255,255,255,0.18)');
    grd.addColorStop(0.85, 'rgba(255,255,255,0.08)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(0, 0, c, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,1)';
    g.lineWidth = 7;
    g.beginPath();
    g.arc(0, 0, c - 6, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 2.5;
    for (const r of [0.28, 0.52, 0.76]) {
      g.beginPath();
      for (let i = 0; i <= 6; i++) {
        const a = (Math.PI / 3) * i;
        const x = Math.cos(a) * r * c;
        const y = Math.sin(a) * r * c;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    for (let i = 0; i < 12; i++) {
      const a = (Math.PI / 6) * i;
      g.beginPath();
      g.moveTo(Math.cos(a) * 12, Math.sin(a) * 12);
      g.lineTo(Math.cos(a) * (c - 8), Math.sin(a) * (c - 8));
      g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,1)';
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i;
      g.beginPath();
      g.arc(Math.cos(a) * 0.76 * c, Math.sin(a) * 0.76 * c, 5, 0, Math.PI * 2);
      g.fill();
    }
  });

/** PROP DROP warning circle (bold ring, dashed inner ring, crosshair). */
const warnTexture = () =>
  tex('card-warn', 256, (g, s) => {
    const c = s / 2;
    g.translate(c, c);
    g.fillStyle = 'rgba(255,255,255,0.14)';
    g.beginPath();
    g.arc(0, 0, c - 6, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,1)';
    g.lineWidth = 12;
    g.beginPath();
    g.arc(0, 0, c - 8, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 5;
    g.setLineDash([14, 10]);
    g.beginPath();
    g.arc(0, 0, c * 0.66, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(-c * 0.4, 0);
    g.lineTo(c * 0.4, 0);
    g.moveTo(0, -c * 0.4);
    g.lineTo(0, c * 0.4);
    g.stroke();
  });

/** STAGE BARRIER screen: scanlines, a bright frame and a lit top edge. */
const barrierTexture = () =>
  tex(
    'card-barrier',
    128,
    (g) => {
      const w = 128;
      const h = 96;
      const grd = g.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, 'rgba(255,255,255,0.75)');
      grd.addColorStop(0.15, 'rgba(255,255,255,0.22)');
      grd.addColorStop(1, 'rgba(255,255,255,0.45)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,0.35)';
      for (let y = 4; y < h; y += 6) g.fillRect(0, y, w, 1.5);
      g.strokeStyle = 'rgba(255,255,255,1)';
      g.lineWidth = 4;
      g.strokeRect(2, 2, w - 4, h - 4);
      g.lineWidth = 2;
      g.strokeStyle = 'rgba(255,255,255,0.5)';
      for (let x = -h; x < w; x += 22) {
        g.beginPath();
        g.moveTo(x, h);
        g.lineTo(x + h * 0.6, 0);
        g.stroke();
      }
    },
    96,
  );

/**
 * Alpha 1.6.1 FREEZE FRAME — the outer time-distortion ring: twelve clock segments in PRIME TIME
 * teal and violet, minute ticks and a ring of timecode digits. Coloured in the texture itself
 * (drawn on the floor only — never a dome).
 */
const timecodeTexture = () =>
  tex('card-timecode', 512, (g, s) => {
    const c = s / 2;
    g.translate(c, c);
    const R = c - 6;
    for (let i = 0; i < 12; i++) {
      const a0 = (Math.PI / 6) * i + 0.05;
      const a1 = (Math.PI / 6) * (i + 1) - 0.05;
      g.strokeStyle = i % 2 ? 'rgba(186,120,255,0.95)' : 'rgba(60,240,230,0.95)';
      g.lineWidth = 14;
      g.beginPath();
      g.arc(0, 0, R - 8, a0, a1);
      g.stroke();
    }
    g.strokeStyle = 'rgba(200,250,255,0.7)';
    for (let i = 0; i < 60; i++) {
      const a = (Math.PI / 30) * i;
      const r0 = i % 5 === 0 ? R - 46 : R - 34;
      g.lineWidth = i % 5 === 0 ? 4 : 2;
      g.beginPath();
      g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      g.lineTo(Math.cos(a) * (R - 22), Math.sin(a) * (R - 22));
      g.stroke();
    }
    g.fillStyle = 'rgba(230,220,255,0.95)';
    g.font = 'bold 22px monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 4) * i + Math.PI / 8;
      g.save();
      g.rotate(a + Math.PI / 2);
      g.fillText(`00:0${i}:${String((i * 7) % 60).padStart(2, '0')}`, 0, -(R - 70));
      g.restore();
    }
    // faint broadcast scanlines across the field
    g.fillStyle = 'rgba(120,200,255,0.06)';
    for (let y = -c; y < c; y += 6) g.fillRect(-c, y, s, 2);
  });

/** FREEZE FRAME — the inner counter-rotating ring: timecode dashes and frame brackets. */
const timecodeInnerTexture = () =>
  tex('card-timecode-in', 256, (g, s) => {
    const c = s / 2;
    g.translate(c, c);
    g.strokeStyle = 'rgba(186,120,255,0.9)';
    g.lineWidth = 6;
    g.setLineDash([18, 12]);
    g.beginPath();
    g.arc(0, 0, c - 10, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    g.strokeStyle = 'rgba(60,240,230,0.85)';
    g.lineWidth = 5;
    const q = c * 0.55;
    const l = c * 0.18;
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      g.beginPath();
      g.moveTo(sx * q, sy * (q - l));
      g.lineTo(sx * q, sy * q);
      g.lineTo(sx * (q - l), sy * q);
      g.stroke();
    }
  });

/** SECOND TAKE — the replay frame on the floor under the echo: REC brackets and a rewind glyph. */
const replayTexture = () =>
  tex('card-replay', 256, (g, s) => {
    const c = s / 2;
    g.strokeStyle = 'rgba(255,255,255,1)';
    g.lineWidth = 10;
    const a = 14;
    const b = s - 14;
    const l = 52;
    g.beginPath();
    g.moveTo(a, a + l);
    g.lineTo(a, a);
    g.lineTo(a + l, a);
    g.moveTo(b - l, a);
    g.lineTo(b, a);
    g.lineTo(b, a + l);
    g.moveTo(b, b - l);
    g.lineTo(b, b);
    g.lineTo(b - l, b);
    g.moveTo(a + l, b);
    g.lineTo(a, b);
    g.lineTo(a, b - l);
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.95)';
    for (const ox of [-26, 14]) {
      g.beginPath();
      g.moveTo(c + ox + 22, c - 26);
      g.lineTo(c + ox - 14, c);
      g.lineTo(c + ox + 22, c + 26);
      g.closePath();
      g.fill();
    }
    g.fillStyle = 'rgba(255,80,110,1)';
    g.beginPath();
    g.arc(a + 40, a + 40, 10, 0, Math.PI * 2);
    g.fill();
  });

/** FRAME CATCH: camera viewfinder corners around a faint field. */
const frameTexture = () =>
  tex('card-frame', 128, (g, s) => {
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fillRect(8, 8, s - 16, s - 16);
    g.strokeStyle = 'rgba(255,255,255,1)';
    g.lineWidth = 9;
    const l = 34;
    const a = 7;
    const b = s - 7;
    g.beginPath();
    g.moveTo(a, a + l);
    g.lineTo(a, a);
    g.lineTo(a + l, a);
    g.moveTo(b - l, a);
    g.lineTo(b, a);
    g.lineTo(b, a + l);
    g.moveTo(b, b - l);
    g.lineTo(b, b);
    g.lineTo(b - l, b);
    g.moveTo(a + l, b);
    g.lineTo(a, b);
    g.lineTo(a, b - l);
    g.stroke();
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.beginPath();
    g.moveTo(s / 2 - 10, s / 2);
    g.lineTo(s / 2 + 10, s / 2);
    g.moveTo(s / 2, s / 2 - 10);
    g.lineTo(s / 2, s / 2 + 10);
    g.stroke();
  });

/** The foam prop crate of PROP DROP: show colours, hazard stripes, a star. */
const crateTexture = () =>
  tex('card-crate', 128, (g, s) => {
    g.fillStyle = '#ffcf3f';
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#1c1c2e';
    for (let i = -s; i < s * 2; i += 24) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + 12, 0);
      g.lineTo(i - s + 12, s);
      g.lineTo(i - s, s);
      g.closePath();
      g.fill();
    }
    g.fillStyle = '#ff3a6a';
    g.fillRect(16, 16, s - 32, s - 32);
    g.fillStyle = '#fff6d0';
    g.beginPath();
    const c = s / 2;
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 13 : 30;
      const a = -Math.PI / 2 + (Math.PI / 5) * i;
      if (i === 0) g.moveTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
      else g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
  });

function addMat(color: number, opacity: number, map: Texture | null = null): MeshBasicMaterial {
  return new MeshBasicMaterial({ color, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, map });
}

function toon(color: number): MeshToonMaterial {
  return new MeshToonMaterial({ color, gradientMap: toonRamp() });
}

interface ObjVis {
  kind: StageKind;
  id: number;
  group: Group;
  /** Pieces by role (see build()). */
  a: Mesh;
  b: Mesh | null;
  c: Mesh | null;
  d: Mesh | null;
  light: Sprite | null;
  props: Mesh[];
  /** PRESSURE MINE: the three fins that open after landing. */
  fins: Mesh[];
  age: number;
  flash: number;
  /** Fade-out after the simulation removed the object (-1 = live). */
  fade: number;
  last: StageObject | null;
  seen: boolean;
  active: boolean;
  /** Thrown pieces (mine, net): where the hand let go, and how long ago it landed (-1 = in the air). */
  rel: Vector3;
  released: boolean;
  landed: number;
}

interface FighterVis {
  tag: Group;
  tagCone: Mesh;
  tagPool: Mesh;
  tagGem: Mesh;
  tagRing: Mesh;
  tether: Group;
  tetherRing: Mesh;
  tetherPost: Mesh;
  cable: Mesh;
  frame: Mesh;
  frameT: number;
  frameFlash: number;
  /** HOLO DECOY projector ring under the hologram. */
  holoRing: Mesh;
}

const _v = new Vector3();
const _v2 = new Vector3();
const _hand = new Vector3();
const _up = new Vector3(0, 1, 0);

/** Renders the Alpha 1.6 set pieces and per-fighter card states. */
export class CardVisuals {
  private root: Group;
  private pool: ObjVis[] = [];
  private byId = new Map<number, ObjVis>();
  private fighters: FighterVis[] = [];
  // shared geometry (built once)
  private floorGeo: PlaneGeometry;
  private puckGeo: CylinderGeometry;
  private finGeo: BoxGeometry;
  private panelGeo: PlaneGeometry;
  private baseGeo: BoxGeometry;
  private lineGeo: PlaneGeometry;
  private coneGeo: ConeGeometry;
  private cableGeo: CylinderGeometry;
  private frameGeo: PlaneGeometry;
  private propGeos: BufferGeometry[];
  private propMats: MeshToonMaterial[];

  constructor(root: Group) {
    this.root = root;
    this.floorGeo = new PlaneGeometry(1, 1);
    this.floorGeo.rotateX(-Math.PI / 2);
    this.puckGeo = new CylinderGeometry(0.2, 0.25, 0.1, 18);
    this.finGeo = new BoxGeometry(0.07, 0.025, 0.2);
    this.finGeo.translate(0, 0, 0.1);
    this.panelGeo = new PlaneGeometry(1, 1);
    this.panelGeo.translate(0, 0.5, 0);
    this.baseGeo = new BoxGeometry(1, 0.09, 0.24);
    this.baseGeo.translate(0, 0.045, 0);
    this.lineGeo = new PlaneGeometry(1, 1);
    this.lineGeo.rotateX(-Math.PI / 2);
    this.lineGeo.translate(0, 0, 0.5);
    this.coneGeo = new ConeGeometry(0.75, 1.5, 22, 1, true);
    this.cableGeo = new CylinderGeometry(0.035, 0.035, 1, 6, 1, true);
    this.cableGeo.translate(0, 0.5, 0);
    this.frameGeo = new PlaneGeometry(2, 2);
    // PROP DROP set pieces: a foam star, a show crate, a stage lamp
    const star = new Shape();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 0.34 : 0.78;
      const a = Math.PI / 2 + (Math.PI / 5) * i;
      if (i === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    star.closePath();
    const starGeo = new ExtrudeGeometry(star, { depth: 0.32, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 1 });
    starGeo.center();
    const crateGeo = new BoxGeometry(1.0, 0.8, 1.0);
    const lampGeo = new CylinderGeometry(0.32, 0.46, 0.85, 18);
    this.propGeos = [starGeo, crateGeo, lampGeo];
    const crateMat = new MeshToonMaterial({ color: 0xffffff, map: crateTexture(), gradientMap: toonRamp() });
    this.propMats = [toon(0xffc23a), crateMat, toon(0x3a3f58)];
    for (let i = 0; i < 2; i++) this.fighters.push(this.buildFighterVis());
  }

  // ---------------------------------------------------------------- build
  private buildFighterVis(): FighterVis {
    const tag = new Group();
    const tagCone = new Mesh(this.coneGeo, addMat(COL.tag, 0.24, glowTexture()));
    tagCone.position.y = 3.15;
    tagCone.renderOrder = 7;
    const lamp = new Mesh(this.puckGeo, toon(0x2a2d40));
    lamp.position.y = 3.95;
    lamp.scale.set(1, 2.2, 1);
    const tagPool = new Mesh(this.floorGeo, addMat(COL.tag, 0.5, glowTexture()));
    tagPool.position.y = 0.05;
    tagPool.scale.setScalar(1.8);
    tagPool.renderOrder = 2;
    // Alpha 1.6.1: a bigger gold marker over the head and a gold ring at the feet — readable even when the fighters overlap
    const tagGem = new Mesh(new OctahedronGeometry(0.3), addMat(0xffd23a, 1));
    tagGem.position.y = 2.95;
    tagGem.renderOrder = 8;
    const tagRing = new Mesh(this.floorGeo, addMat(0xffd23a, 0.75, ringTexture()));
    tagRing.position.y = 0.07;
    tagRing.renderOrder = 3;
    tag.add(tagCone, lamp, tagPool, tagGem, tagRing);
    tag.visible = false;
    const tether = new Group();
    const tetherRing = new Mesh(this.floorGeo, addMat(COL.cable, 0.55, ringTexture()));
    tetherRing.position.y = 0.06;
    tetherRing.renderOrder = 2;
    const tetherPost = new Mesh(this.puckGeo, toon(0x30361a));
    tetherPost.scale.set(0.9, 2.6, 0.9);
    tetherPost.position.y = 0.13;
    const cable = new Mesh(this.cableGeo, addMat(COL.cable, 0.95));
    cable.renderOrder = 6;
    tether.add(tetherRing, tetherPost, cable);
    tether.visible = false;
    const frame = new Mesh(this.frameGeo, addMat(COL.frame, 0.9, frameTexture()));
    frame.visible = false;
    frame.renderOrder = 7;
    const holoRing = new Mesh(this.floorGeo, addMat(0xff7ad9, 0.6, ringTexture()));
    holoRing.visible = false;
    holoRing.renderOrder = 2;
    this.root.add(tag, tether, frame, holoRing);
    return { tag, tagCone, tagPool, tagGem, tagRing, tether, tetherRing, tetherPost, cable, frame, frameT: 0, frameFlash: 0, holoRing };
  }

  private build(kind: StageKind): ObjVis {
    const group = new Group();
    let a: Mesh;
    let b: Mesh | null = null;
    let c: Mesh | null = null;
    let d: Mesh | null = null;
    let light: Sprite | null = null;
    const props: Mesh[] = [];
    const fins: Mesh[] = [];
    switch (kind) {
      case 'net': {
        a = new Mesh(this.floorGeo, addMat(COL.net, 0.8, netTexture()));
        a.renderOrder = 2;
        b = new Mesh(this.puckGeo, toon(0x1e3a40));
        light = new Sprite(new SpriteMaterial({ map: glowTexture(), color: COL.net, blending: AdditiveBlending, depthWrite: false, transparent: true }));
        light.scale.setScalar(0.7);
        b.add(light);
        light.position.y = 0.12;
        group.add(a, b);
        break;
      }
      case 'mine': {
        a = new Mesh(this.floorGeo, addMat(COL.mine, 0.35, ringTexture()));
        a.renderOrder = 2;
        b = new Mesh(this.puckGeo, toon(0x2b2238));
        c = new Mesh(this.puckGeo, addMat(COL.mine, 0.9));
        c.scale.set(0.55, 0.6, 0.55);
        c.position.y = 0.07;
        b.add(c);
        // three fins fold out once it lands
        for (let i = 0; i < 3; i++) {
          const pivot = new Group();
          pivot.rotation.y = (Math.PI * 2 * i) / 3;
          const fin = new Mesh(this.finGeo, toon(0xff4a6e));
          fin.position.set(0, 0, 0.17);
          pivot.add(fin);
          b.add(pivot);
          fins.push(fin);
        }
        light = new Sprite(new SpriteMaterial({ map: glowTexture(), color: COL.mine, blending: AdditiveBlending, depthWrite: false, transparent: true }));
        light.position.y = 0.16;
        b.add(light);
        group.add(a, b);
        break;
      }
      case 'barrier': {
        a = new Mesh(this.panelGeo, addMat(COL.barrier, 0.55, barrierTexture()));
        a.renderOrder = 8;
        b = new Mesh(this.baseGeo, toon(0x1d2a44));
        c = new Mesh(this.baseGeo, addMat(COL.barrier, 0.9));
        c.scale.set(1, 0.4, 1.15);
        c.position.y = 0.09;
        group.add(a, b, c);
        break;
      }
      case 'prop': {
        a = new Mesh(this.floorGeo, addMat(COL.warn, 0.85, warnTexture()));
        a.renderOrder = 3;
        b = new Mesh(this.floorGeo, addMat(COL.warnHot, 0.7, ringTexture()));
        b.renderOrder = 3;
        for (let i = 0; i < 3; i++) {
          const pm = new Mesh(this.propGeos[i], this.propMats[i]);
          pm.visible = false;
          props.push(pm);
          group.add(pm);
        }
        // the stage lamp's lit lens
        const lens = new Mesh(this.puckGeo, addMat(0xfff2b0, 1));
        lens.scale.set(1.25, 0.2, 1.25);
        lens.position.y = -0.43;
        props[2].add(lens);
        group.add(a, b);
        break;
      }
      case 'echo': {
        // SECOND TAKE: the aim line, the replay frame on the floor, a soft glow (the ghost itself is drawn by BattleView)
        a = new Mesh(this.lineGeo, addMat(COL.echo, 0.3));
        a.renderOrder = 6;
        b = new Mesh(this.floorGeo, addMat(COL.echo, 0.8, replayTexture()));
        b.renderOrder = 3;
        c = new Mesh(this.floorGeo, addMat(COL.echo, 0.45, glowTexture()));
        c.renderOrder = 2;
        group.add(a, b, c);
        break;
      }
      case 'freeze': {
        // FREEZE FRAME: floor only — an outer timecode ring, an inner counter-rotating ring and a
        // sweeping second hand (no dome, no wall, nothing that reads as SHIELD)
        a = new Mesh(this.floorGeo, addMat(0xffffff, 0.8, timecodeTexture()));
        a.renderOrder = 2;
        b = new Mesh(this.floorGeo, addMat(0xffffff, 0.75, timecodeInnerTexture()));
        b.renderOrder = 2;
        c = new Mesh(this.lineGeo, addMat(0x7ff6ff, 0.55, glowTexture()));
        c.renderOrder = 3;
        group.add(a, b, c);
        break;
      }
    }
    group.visible = false;
    this.root.add(group);
    return { kind, id: -1, group, a, b, c, d, light, props, fins, age: 0, flash: 0, fade: -1, last: null, seen: false, active: false, rel: new Vector3(), released: false, landed: -1 };
  }

  private acquire(kind: StageKind, id: number): ObjVis {
    let v = this.pool.find((p) => !p.active && p.kind === kind);
    if (!v) {
      v = this.build(kind);
      this.pool.push(v);
    }
    v.id = id;
    v.active = true;
    v.age = 0;
    v.flash = 0;
    v.fade = -1;
    v.released = false;
    v.landed = -1;
    v.group.visible = true;
    for (const p of v.props) p.visible = false;
    this.byId.set(id, v);
    return v;
  }

  private release(v: ObjVis): void {
    v.active = false;
    v.group.visible = false;
    v.last = null;
    this.byId.delete(v.id);
    v.id = -1;
  }

  /** Hide everything (new fight, Survival wave, leaving the battle). Meshes stay pooled. */
  reset(): void {
    for (const v of this.pool) if (v.active) this.release(v);
    for (const f of this.fighters) {
      f.tag.visible = false;
      f.tether.visible = false;
      f.frame.visible = false;
      f.holoRing.visible = false;
      f.frameFlash = 0;
    }
  }

  /** An object was hit (barrier) — a short flicker. */
  pulse(id: number): void {
    const v = this.byId.get(id);
    if (v) v.flash = 1;
  }

  /** FRAME CATCH parried a shot: the frame flares. */
  parry(side: number): void {
    const fv = this.fighters[side];
    if (fv) fv.frameFlash = 1;
  }

  // --------------------------------------------------------------- update
  /**
   * `pos`: where each fighter is drawn; `hand`: the world position of a fighter's free (left)
   * hand — thrown pieces wait there until the throw lets go of them.
   */
  update(dt: number, t: number, m: Match, pos: (side: number) => Vector3, hand: (side: number, out: Vector3) => Vector3): void {
    for (const v of this.pool) v.seen = false;
    for (const o of m.objects.list) {
      const v = this.byId.get(o.id) ?? this.acquire(o.kind, o.id);
      v.last = o;
      v.seen = true;
      v.age += dt;
      v.flash = Math.max(0, v.flash - dt * 5);
      if (v.landed >= 0) v.landed += dt;
      this.sync(v, o, t, 1, hand);
    }
    // removed by the simulation: fade out from the last state
    for (const v of this.pool) {
      if (!v.active || v.seen) continue;
      if (v.fade < 0) v.fade = 0;
      v.fade += dt;
      const k = 1 - v.fade / 0.3;
      if (k <= 0 || !v.last) {
        this.release(v);
        continue;
      }
      this.sync(v, v.last, t, k, hand);
    }
    for (const f of m.fighters) this.syncFighter(this.fighters[f.side], f, m, t, dt, pos(f.side));
  }

  /**
   * A thrown piece in the air (Alpha 1.6.1): in the free hand until the throw lets go
   * (`release` s after the card), then an arc from the hand to the landing point that ends
   * exactly when the simulation lands it. Visual only — the card's timing is untouched.
   */
  private thrown(v: ObjVis, o: StageObject, side: number, release: number, arc: number, hand: (side: number, out: Vector3) => Vector3, out: Vector3): void {
    if (o.t < release && !v.released) {
      hand(side, out);
      v.rel.copy(out);
      return;
    }
    v.released = true;
    const p = clamp01((o.t - release) / Math.max(0.05, o.total - release));
    out.set(lerp(v.rel.x, o.x, p), lerp(v.rel.y, 0.06, p) + arc * p * (1 - p), lerp(v.rel.z, o.z, p));
  }

  private sync(v: ObjVis, o: StageObject, t: number, k: number, hand: (side: number, out: Vector3) => Vector3): void {
    const g = v.group;
    switch (o.kind) {
      case 'net': {
        const disc = v.a;
        const puck = v.b!;
        if (o.stage === 'fly') {
          g.position.set(0, 0, 0);
          this.thrown(v, o, o.owner, THROW_RELEASE.lob, 1.4, hand, _v);
          puck.position.copy(_v);
          puck.rotation.y = v.released ? t * 14 : 0;
          puck.scale.setScalar(v.released ? 1 : 0.8);
          disc.visible = false;
        } else {
          puck.scale.setScalar(1);
          puck.position.set(o.x, 0.06, o.z);
          puck.rotation.y = t * 2;
          const open = clamp01(o.t / 0.22);
          const end = clamp01((o.total - o.t) / 0.45);
          disc.visible = true;
          disc.position.set(o.x, 0.05, o.z);
          disc.rotation.y = t * 0.5;
          disc.scale.setScalar(o.radius * 2 * (0.3 + 0.7 * open));
          (disc.material as MeshBasicMaterial).opacity = (0.65 + Math.sin(t * 7) * 0.12) * end * k;
        }
        (v.light!.material as SpriteMaterial).opacity = (o.stage === 'fly' ? 0.6 : 0.9 + Math.sin(t * 12) * 0.1) * k;
        break;
      }
      case 'mine': {
        const ring = v.a;
        const puck = v.b!;
        let fold = 1;
        if (o.stage === 'fly') {
          this.thrown(v, o, o.owner, THROW_RELEASE.lob, 1.8, hand, _v);
          puck.position.copy(_v);
          puck.rotation.set(v.released ? t * 9 : 0, v.released ? t * 6 : 0, 0);
          puck.scale.setScalar(v.released ? 1 : 0.8);
          ring.visible = false;
        } else {
          if (v.landed < 0) v.landed = 0;
          // lands, hops once, then the fins fold out
          const hop = v.landed < 0.24 ? Math.abs(Math.sin((v.landed / 0.24) * Math.PI)) * 0.16 * (1 - v.landed / 0.24) : 0;
          puck.position.set(o.x, 0.06 + hop, o.z);
          puck.rotation.set(0, 0, 0);
          puck.scale.setScalar(1);
          fold = 1 - clamp01((v.landed - 0.18) / 0.25);
          ring.visible = true;
          ring.position.set(o.x, 0.055, o.z);
          ring.scale.setScalar(o.radius * 2.4 * (1 - fold * 0.6));
        }
        for (const fin of v.fins) {
          const pivot = fin.parent!;
          pivot.rotation.x = -1.25 * fold;
        }
        const armed = o.stage === 'armed';
        const rate = armed ? 7 : 3;
        const blink = Math.sin(t * rate * Math.PI * 2) > 0 ? 1 : 0.25;
        const col = armed ? COL.mine : COL.mineArm;
        const lm = v.light!.material as SpriteMaterial;
        lm.color.setHex(col);
        lm.opacity = (o.stage === 'fly' ? 0.3 : blink) * k;
        v.light!.scale.setScalar(armed ? 0.8 : 0.55);
        (v.c!.material as MeshBasicMaterial).color.setHex(col);
        (v.c!.material as MeshBasicMaterial).opacity = (0.4 + blink * 0.6) * k;
        (ring.material as MeshBasicMaterial).color.setHex(col);
        (ring.material as MeshBasicMaterial).opacity = (armed ? 0.32 + blink * 0.12 : 0.12) * k;
        break;
      }
      case 'barrier': {
        g.position.set(o.x, 0, o.z);
        g.rotation.y = Math.atan2(-o.dirZ, o.dirX);
        const unfold = clamp01(v.age / 0.25);
        const end = clamp01((o.total - o.t) / 0.4);
        const hpK = o.maxHp > 0 ? o.hp / o.maxHp : 1;
        const flick = o.total - o.t < 1 ? (Math.sin(t * 40) > 0 ? 1 : 0.5) : 1;
        v.a.scale.set(o.radius * 2, 1.75 * unfold * Math.max(0.05, end), 1);
        (v.a.material as MeshBasicMaterial).opacity = (0.32 + 0.3 * hpK + v.flash * 0.5) * flick * k;
        v.b!.scale.set(o.radius * 2 + 0.2, 1, 1);
        v.c!.scale.set(o.radius * 2 + 0.1, 0.4, 1.15);
        (v.c!.material as MeshBasicMaterial).opacity = (0.6 + v.flash * 0.4) * k * end;
        break;
      }
      case 'prop': {
        const warn = v.a;
        const inner = v.b!;
        const prop = v.props[o.variant] ?? v.props[0];
        if (o.stage === 'warn') {
          const p = clamp01(o.t / o.total);
          const rate = 3 + p * 9;
          const blink = 0.55 + 0.45 * (Math.sin(t * rate * Math.PI * 2) > 0 ? 1 : 0);
          warn.visible = inner.visible = true;
          warn.position.set(o.x, 0.06, o.z);
          warn.scale.setScalar(o.radius * 2);
          warn.rotation.y = t * 0.8;
          (warn.material as MeshBasicMaterial).color.setHex(p > 0.6 ? COL.warnHot : COL.warn);
          (warn.material as MeshBasicMaterial).opacity = blink * k;
          inner.position.set(o.x, 0.065, o.z);
          inner.scale.setScalar(Math.max(0.05, o.radius * 2.3 * (1 - p)));
          (inner.material as MeshBasicMaterial).opacity = 0.8 * k;
          // the set piece falls through the last third of a second
          const rem = o.total - o.t;
          if (rem < 0.38) {
            const q = rem / 0.38;
            prop.visible = true;
            prop.position.set(o.x, 0.45 + 7.5 * q * q, o.z);
            prop.rotation.set(q * 1.4, o.variant + q * 3, q * 0.6);
            prop.scale.setScalar(1);
          } else prop.visible = false;
        } else {
          warn.visible = inner.visible = false;
          prop.visible = true;
          const sink = clamp01((o.t - (o.total - 0.35)) / 0.35);
          prop.position.set(o.x, 0.42 - sink * 0.8, o.z);
          prop.rotation.set(0, o.variant, 0);
          prop.scale.setScalar(Math.max(0.01, (1 - sink * 0.4) * k));
        }
        break;
      }
      case 'echo': {
        g.position.set(o.x, 0, o.z);
        const line = v.a;
        const frame = v.b!;
        const glow = v.c!;
        const open = clamp01(v.age / 0.15);
        const noise = 0.85 + 0.15 * Math.sin(t * 61 + o.id);
        frame.position.y = 0.07;
        frame.scale.setScalar(1.9 * (0.6 + 0.4 * open));
        frame.rotation.y = Math.atan2(o.dirX, o.dirZ);
        (frame.material as MeshBasicMaterial).opacity = (o.stage === 'retract' ? 0.4 : 0.85) * noise * k;
        glow.position.y = 0.05;
        glow.scale.setScalar(2.4);
        (glow.material as MeshBasicMaterial).opacity = 0.35 * noise * k;
        if (o.stage === 'retract') line.visible = false;
        else {
          const lock = o.stage === 'lock';
          const len = TAKE_CARDS[o.variant] === 'rebound_disc' ? CARD_TUNING.rebound_disc.reach : lineReach(o.x + o.dirX * 0.4, o.z + o.dirZ * 0.4, o.dirX, o.dirZ, 15) + 0.4;
          line.visible = true;
          line.position.set(0, 1.05, 0);
          line.rotation.y = Math.atan2(o.dirX, o.dirZ);
          line.scale.set(lock ? 0.42 : 0.16, 1, len);
          (line.material as MeshBasicMaterial).opacity = (lock ? 0.45 + 0.35 * Math.abs(Math.sin(t * 18)) : 0.14) * k;
        }
        break;
      }
      case 'freeze': {
        g.position.set(o.x, 0, o.z);
        const open = clamp01(v.age / 0.25);
        const end = clamp01((o.total - o.t) / 0.45);
        const r = o.radius * (0.4 + 0.6 * open);
        // light TV interference: a jittery shimmer and an occasional dropout
        const noise = 0.82 + 0.18 * Math.sin(t * 47) * Math.sin(t * 13 + 1.7);
        const drop = Math.sin(t * 7.3) > 0.97 ? 0.45 : 1;
        v.a.position.y = 0.05;
        v.a.scale.setScalar(r * 2);
        v.a.rotation.y = -t * 0.45;
        (v.a.material as MeshBasicMaterial).opacity = 0.75 * end * k * noise * drop;
        v.b!.position.y = 0.055;
        v.b!.scale.setScalar(r * 1.25);
        v.b!.rotation.y = t * 0.9;
        (v.b!.material as MeshBasicMaterial).opacity = 0.7 * end * k * noise;
        // the sweeping second hand
        v.c!.position.y = 0.06;
        v.c!.rotation.y = -t * 2.6;
        v.c!.scale.set(0.22, 1, r * 0.95);
        (v.c!.material as MeshBasicMaterial).opacity = 0.55 * end * k;
        break;
      }
    }
  }

  private syncFighter(fv: FighterVis, f: FighterSim, m: Match, t: number, dt: number, p: Vector3): void {
    // SPOTLIGHT TAG: a studio lamp over the head, a gold marker and a gold ring at the feet
    const tagged = f.tag > 0 && !f.ko && m.phase === 'fight';
    fv.tag.visible = tagged;
    if (tagged) {
      fv.tag.position.set(p.x, 0, p.z);
      const blink = f.tag < 1.2 ? (Math.sin(t * 24) > 0 ? 1 : 0.35) : 1;
      (fv.tagCone.material as MeshBasicMaterial).opacity = (0.2 + 0.07 * Math.sin(t * 6)) * blink;
      (fv.tagPool.material as MeshBasicMaterial).opacity = 0.45 * blink;
      fv.tagGem.rotation.y = t * 4;
      fv.tagGem.position.y = 2.95 + Math.sin(t * 5) * 0.08;
      (fv.tagGem.material as MeshBasicMaterial).opacity = blink;
      fv.tagRing.scale.setScalar(1.9 + Math.sin(t * 6) * 0.12);
      fv.tagRing.rotation.y = -t;
      (fv.tagRing.material as MeshBasicMaterial).opacity = 0.75 * blink;
    }
    // CABLE SNARE: the cable from its floor anchor to the waist, the reach ring on the floor
    const held = f.tether > 0 && !f.ko;
    fv.tether.visible = held;
    if (held) {
      fv.tetherRing.position.set(f.tetherX, 0.06, f.tetherZ);
      fv.tetherRing.scale.setScalar(f.tetherR * 2.25);
      (fv.tetherRing.material as MeshBasicMaterial).opacity = 0.4 + 0.12 * Math.sin(t * 9);
      fv.tetherPost.position.set(f.tetherX, 0.13, f.tetherZ);
      _v.set(f.tetherX, 0.25, f.tetherZ);
      _v2.set(p.x, 0.95, p.z);
      const len = _v.distanceTo(_v2);
      fv.cable.position.copy(_v);
      fv.cable.scale.set(1, Math.max(0.01, len), 1);
      _v2.sub(_v).normalize();
      fv.cable.quaternion.setFromUnitVectors(_up, _v2);
      const taut = Math.hypot(p.x - f.tetherX, p.z - f.tetherZ) / Math.max(0.1, f.tetherR);
      (fv.cable.material as MeshBasicMaterial).opacity = 0.6 + 0.4 * clamp01(taut);
    }
    // FRAME CATCH: the viewfinder frame in front of the fighter; it flares on a parry
    fv.frameFlash = Math.max(0, fv.frameFlash - dt * 4);
    const framed = (f.frame > 0 || fv.frameFlash > 0.05) && !f.ko;
    fv.frame.visible = framed;
    if (framed) {
      fv.frameT += dt;
      const tt = CARD_TUNING.frame_catch;
      const fx = Math.sin(f.facing);
      const fz = Math.cos(f.facing);
      fv.frame.position.set(p.x + fx * tt.ahead, 1.15, p.z + fz * tt.ahead);
      fv.frame.rotation.set(0, f.facing, 0);
      const open = clamp01(fv.frameT / 0.12);
      fv.frame.scale.setScalar((0.6 + 0.4 * open) * (1 + fv.frameFlash * 0.25));
      const end = f.frame > 0 && f.frame < 0.3 ? (Math.sin(t * 40) > 0 ? 1 : 0.4) : 1;
      const mat = fv.frame.material as MeshBasicMaterial;
      mat.opacity = Math.min(1, 0.9 * end + fv.frameFlash);
      mat.color.setHex(fv.frameFlash > 0.1 ? 0xffffff : COL.frame);
    } else fv.frameT = 0;
    // HOLO DECOY: a projector ring under this fighter's hologram
    const holo = m.decoys.find((d) => d.alive && d.owner === f.side && d.kind === 'holo');
    fv.holoRing.visible = !!holo;
    if (holo) {
      const glitch = holo.soak >= 0 ? (Math.sin(t * 53) > 0.2 ? 0.25 : 1) : 1;
      fv.holoRing.position.set(holo.x, 0.06, holo.z);
      fv.holoRing.scale.setScalar(1.6 + Math.sin(t * 9) * 0.1);
      (fv.holoRing.material as MeshBasicMaterial).opacity = 0.6 * glitch;
    }
    void _hand;
  }
}
