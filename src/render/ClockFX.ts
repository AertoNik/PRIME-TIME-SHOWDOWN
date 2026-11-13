import { AdditiveBlending, CanvasTexture, Color, Group, Sprite, SpriteMaterial, type Object3D, type Vector3 } from 'three';
import type { Side } from '../config/types';
import { canvasTexture, makeCanvas } from './textures';

// Alpha 1.9.7 — CRAX's TWELFTH STRIKE on screen: a small gold clock dial floats over his head while the clock runs
// (its twelve marks light up as his shots land — the simulation's `clock` events), turns bright gold at twelve, and
// bursts at the target when the hour strikes. Plus his victory's gold gears. A handful of sprites (no lights, no
// shadows): cheap on a phone. Visual only — the fight never reads it.

const GOLD = new Color(0xffcc4d);

function dialTexture(marks: number, ready: boolean): CanvasTexture {
  const S = 128;
  const { c, g } = makeCanvas(S, S);
  const r = S / 2;
  g.fillStyle = ready ? 'rgba(255,204,77,0.28)' : 'rgba(20,14,40,0.55)';
  g.beginPath();
  g.arc(r, r, r * 0.86, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 7;
  g.strokeStyle = ready ? '#fff2b0' : '#ffcc4d';
  g.stroke();
  for (let k = 0; k < 12; k++) {
    const a = ((k + 1) / 12) * Math.PI * 2;
    const lit = k < marks;
    g.save();
    g.translate(r + Math.sin(a) * r * 0.64, r - Math.cos(a) * r * 0.64);
    g.rotate(a);
    g.fillStyle = lit ? (ready ? '#ffffff' : '#ffd36a') : 'rgba(255,220,150,0.25)';
    const big = (k + 1) % 3 === 0;
    g.fillRect(-3, big ? -9 : -6, 6, big ? 18 : 12);
    g.restore();
  }
  // the hand
  const a = (marks / 12) * Math.PI * 2;
  g.strokeStyle = ready ? '#ffffff' : '#fff4d0';
  g.lineWidth = 6;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(r, r);
  g.lineTo(r + Math.sin(a) * r * 0.5, r - Math.cos(a) * r * 0.5);
  g.stroke();
  g.fillStyle = '#ffcc4d';
  g.beginPath();
  g.arc(r, r, 6, 0, Math.PI * 2);
  g.fill();
  return canvasTexture(c);
}

function gearTexture(): CanvasTexture {
  const S = 64;
  const { c, g } = makeCanvas(S, S);
  const r = S / 2;
  g.fillStyle = '#ffd36a';
  g.beginPath();
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const rr = k % 2 ? r * 0.72 : r * 0.94;
    const x = r + Math.cos(a) * rr;
    const y = r + Math.sin(a) * rr;
    if (k === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.fill();
  g.globalCompositeOperation = 'destination-out';
  g.beginPath();
  g.arc(r, r, r * 0.3, 0, Math.PI * 2);
  g.fill();
  return canvasTexture(c);
}

interface Dial {
  sprite: Sprite;
  mat: SpriteMaterial;
  marks: number;
  ready: boolean;
  /** 0..1 fade-in, then held; < 0: fading out. */
  w: number;
  out: boolean;
}

interface Gear {
  s: Sprite;
  vx: number;
  vy: number;
  vz: number;
  life: number;
}

export class ClockFX {
  private root = new Group();
  private dials: Dial[];
  private cache = new Map<string, CanvasTexture>();
  private flash: Sprite;
  private flashMat: SpriteMaterial;
  private flashT = -1;
  private gearMat: SpriteMaterial;
  private gears: Gear[] = [];
  private time = 0;

  constructor(parent: Object3D) {
    parent.add(this.root);
    this.dials = [0, 1].map(() => {
      const mat = new SpriteMaterial({ map: this.tex(0, false), transparent: true, depthWrite: false, opacity: 0 });
      const sprite = new Sprite(mat);
      sprite.scale.setScalar(0.95);
      sprite.visible = false;
      this.root.add(sprite);
      return { sprite, mat, marks: 0, ready: false, w: 0, out: false };
    });
    this.flashMat = new SpriteMaterial({ map: this.tex(12, true), transparent: true, depthWrite: false, blending: AdditiveBlending, opacity: 0 });
    this.flash = new Sprite(this.flashMat);
    this.flash.visible = false;
    this.root.add(this.flash);
    this.gearMat = new SpriteMaterial({ map: gearTexture(), transparent: true, depthWrite: false });
    for (let i = 0; i < 14; i++) {
      const s = new Sprite(this.gearMat);
      s.visible = false;
      this.root.add(s);
      this.gears.push({ s, vx: 0, vy: 0, vz: 0, life: 0 });
    }
  }

  private tex(marks: number, ready: boolean): CanvasTexture {
    const k = `${marks}:${ready ? 1 : 0}`;
    let t = this.cache.get(k);
    if (!t) {
      t = dialTexture(marks, ready);
      this.cache.set(k, t);
    }
    return t;
  }

  /** The key turned: the dial appears over `side`. */
  wind(side: Side): void {
    const d = this.dials[side];
    d.marks = 0;
    d.ready = false;
    d.out = false;
    d.w = Math.max(0, d.w);
    d.mat.map = this.tex(0, false);
    d.sprite.visible = true;
  }

  setMarks(side: Side, marks: number, ready: boolean): void {
    const d = this.dials[side];
    d.marks = marks;
    d.ready = ready;
    d.mat.map = this.tex(Math.max(0, Math.min(12, marks)), ready);
    d.sprite.visible = true;
    d.out = false;
  }

  /** The clock stopped or struck: the dial fades. */
  stop(side: Side): void {
    this.dials[side].out = true;
  }

  /** The hour struck at (x, z): a big gold dial flashes there and gold gears fly. */
  strike(x: number, z: number, blocked: boolean): void {
    this.flash.position.set(x, 1.5, z);
    this.flash.visible = true;
    this.flashT = 0;
    this.flashMat.color.copy(GOLD).multiplyScalar(blocked ? 0.6 : 1.6);
    if (!blocked) this.gearBurst(x, 1.4, z, 7, 4.5);
  }

  /** CRAX's victory: gold gears showered over him. */
  victory(at: Vector3): void {
    this.gearBurst(at.x, at.y + 2.2, at.z, 14, 3.2);
  }

  private gearBurst(x: number, y: number, z: number, n: number, speed: number): void {
    let made = 0;
    for (const g of this.gears) {
      if (made >= n) break;
      if (g.life > 0) continue;
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.5 + Math.random() * 0.6);
      g.vx = Math.cos(a) * v * 0.5;
      g.vz = Math.sin(a) * v * 0.5;
      g.vy = v * (0.8 + Math.random() * 0.5);
      g.life = 1.4 + Math.random() * 0.5;
      g.s.position.set(x, y, z);
      g.s.scale.setScalar(0.18 + Math.random() * 0.14);
      g.s.visible = true;
      made++;
    }
  }

  reset(): void {
    for (const d of this.dials) {
      d.w = 0;
      d.out = false;
      d.sprite.visible = false;
      d.mat.opacity = 0;
    }
    this.flash.visible = false;
    this.flashT = -1;
    for (const g of this.gears) {
      g.life = 0;
      g.s.visible = false;
    }
  }

  update(dt: number, posOf: (side: Side) => Vector3): void {
    this.time += dt;
    for (let side = 0 as Side; side <= 1; side = (side + 1) as Side) {
      const d = this.dials[side];
      if (!d.sprite.visible) continue;
      d.w = d.out ? d.w - dt * 2.5 : Math.min(1, d.w + dt * 5);
      if (d.w <= 0 && d.out) {
        d.sprite.visible = false;
        d.w = 0;
        continue;
      }
      const p = posOf(side);
      const pulse = d.ready ? 1 + Math.sin(this.time * 12) * 0.08 : 1;
      d.sprite.position.set(p.x, 2.45 + Math.sin(this.time * 2) * 0.03, p.z);
      d.sprite.scale.setScalar(0.9 * pulse * (0.6 + 0.4 * d.w));
      d.mat.opacity = Math.max(0, d.w);
      d.mat.rotation = d.ready ? Math.sin(this.time * 18) * 0.05 : 0;
    }
    if (this.flashT >= 0) {
      this.flashT += dt;
      const p = this.flashT / 0.55;
      if (p >= 1) {
        this.flashT = -1;
        this.flash.visible = false;
      } else {
        this.flash.scale.setScalar(1.2 + p * 2.6);
        this.flashMat.opacity = 1 - p;
      }
    }
    for (const g of this.gears) {
      if (g.life <= 0) continue;
      g.life -= dt;
      if (g.life <= 0) {
        g.s.visible = false;
        continue;
      }
      g.vy -= 9 * dt;
      g.s.position.x += g.vx * dt;
      g.s.position.y = Math.max(0.08, g.s.position.y + g.vy * dt);
      g.s.position.z += g.vz * dt;
    }
    // (the gears share one material: they spin together)
    this.gearMat.rotation = (this.gearMat.rotation + dt * 6) % (Math.PI * 2);
  }

  dispose(): void {
    for (const t of this.cache.values()) t.dispose();
    for (const d of this.dials) d.mat.dispose();
    this.flashMat.dispose();
    this.gearMat.map?.dispose();
    this.gearMat.dispose();
    this.root.removeFromParent();
  }
}
