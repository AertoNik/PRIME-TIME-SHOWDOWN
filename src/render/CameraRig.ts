import { Vector3 } from 'three';
import { clamp, damp, ease } from '../core/math';
import type { Renderer } from './Renderer';

export type CamMode = 'showcase' | 'battle' | 'finish' | 'intro';

interface Pose {
  pos: Vector3;
  look: Vector3;
  fov: number;
  /** Fraction of screen height to push the image up (HUD-aware framing). */
  shift: number;
}

function clonePose(p: Pose): Pose {
  return { pos: p.pos.clone(), look: p.look.clone(), fov: p.fov, shift: p.shift };
}

const PITCH = 0.93;

/** Smooth, readable camera: frames both fighters, reacts to big hits. */
export class CameraRig {
  private r: Renderer;
  mode: CamMode = 'showcase';
  private cur: Pose = { pos: new Vector3(0, 2, 6), look: new Vector3(0, 1, 0), fov: 36, shift: 0 };
  private from: Pose | null = null;
  private blend = 1;
  private blendDur = 1.2;

  // battle state
  private bTarget = new Vector3();
  private bDist = 18;
  private trauma = 0;
  private punch = 0;
  private t = 0;
  private distGoal = 18;
  /** 1 = full camera motion, 0.5 = reduced, 0 = no shake/kicks/accents. */
  intensity = 1;
  private accentT = 0;
  private accentStrength = 0;
  private accentPos = new Vector3();

  // showcase
  showcasePos = new Vector3(0, 0, 0);
  showcaseShift = 0.16;
  showcaseDist = 5.2;
  showcaseHeight = 1.05;
  // finish
  finishFocus = new Vector3();
  finishSide = 1;
  finishShift = 0.04;
  finishDist = 7.5;
  // HUD safe area in screen fractions
  hudTop = 0.165;
  hudBottom = 0.265;

  constructor(r: Renderer) {
    this.r = r;
  }

  setMode(mode: CamMode, blendDur = 1.2): void {
    if (mode === this.mode) return;
    this.from = clonePose(this.cur);
    this.blend = 0;
    this.blendDur = blendDur;
    this.mode = mode;
  }

  snapBattle(a: Vector3, b: Vector3): void {
    this.bTarget.set((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
    this.bDist = this.requiredDistance(this.bTarget, [a, b]);
    this.distGoal = this.bDist;
    this.accentT = 0;
  }

  addTrauma(v: number): void {
    this.trauma = Math.min(1, this.trauma + v * this.intensity);
  }

  kick(v: number): void {
    this.punch = Math.min(1.5, this.punch + v * this.intensity);
  }

  /** Brief push toward a highlight (combo payoff). Fully skipped when motion is off. */
  focusAccent(p: Vector3, strength: number): void {
    if (this.intensity <= 0) return;
    this.accentPos.copy(p);
    this.accentStrength = strength * this.intensity;
    this.accentT = 0.75;
  }

  /** Distance needed so both fighters (feet + heads) fit the HUD-safe area. */
  private requiredDistance(target: Vector3, pts: Vector3[]): number {
    const fov = 40;
    const tanV = Math.tan((fov * Math.PI) / 360);
    const { w, h } = this.r.size;
    const aspect = w / h;
    const safeHalfY = (1 - this.hudTop - this.hudBottom) * 0.94;
    const safeHalfX = 0.86;
    const sp = Math.sin(PITCH);
    const cp = Math.cos(PITCH);
    const fits = (d: number) => {
      const cx = target.x;
      const cy = target.y + sp * d;
      const cz = target.z + cp * d;
      for (const p of pts) {
        for (const yy of [-0.2, 2.9]) {
          const rx = p.x - cx;
          const ry = p.y + yy - cy;
          const rz = p.z - cz;
          const zc = ry * -sp + rz * -cp;
          const xc = rx;
          const yc = ry * cp + rz * -sp;
          if (zc <= 0.1) return false;
          const nx = xc / (zc * tanV * aspect);
          const ny = yc / (zc * tanV);
          if (Math.abs(nx) > safeHalfX || Math.abs(ny) > safeHalfY) return false;
        }
      }
      return true;
    };
    let lo = 17.5;
    let hi = 32;
    if (fits(lo)) return lo;
    for (let i = 0; i < 9; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  private battlePose(a: Vector3, b: Vector3, dt: number): Pose {
    let tx = clamp((a.x + b.x) / 2, -3.2, 3.2);
    let tz = clamp((a.z + b.z) / 2, -5.2, 5.2);
    // combo accent: lean the frame toward the highlight for a beat
    let accent = 0;
    if (this.accentT > 0) {
      this.accentT = Math.max(0, this.accentT - dt);
      const p = 1 - this.accentT / 0.75;
      accent = Math.sin(Math.min(1, p * 1.6) * Math.PI) * this.accentStrength;
      tx += (this.accentPos.x - tx) * 0.3 * accent;
      tz += (this.accentPos.z - tz) * 0.3 * accent;
    }
    this.bTarget.x = damp(this.bTarget.x, tx, 2.6, dt);
    this.bTarget.z = damp(this.bTarget.z, tz, 2.6, dt);
    const req = this.requiredDistance(this.bTarget, [a, b]);
    // hysteresis: zoom out promptly, zoom in only for meaningful changes
    if (req > this.distGoal || this.distGoal - req > 1.2) this.distGoal = req;
    this.bDist = damp(this.bDist, this.distGoal, this.distGoal > this.bDist ? 3 : 0.8, dt);
    const d = this.bDist * (1 - 0.1 * accent);
    return {
      pos: new Vector3(this.bTarget.x, Math.sin(PITCH) * d, this.bTarget.z + Math.cos(PITCH) * d),
      look: this.bTarget.clone(),
      fov: 40,
      shift: (this.hudBottom - this.hudTop) / 2,
    };
  }

  private showcasePose(): Pose {
    const sway = Math.sin(this.t * 0.35) * 0.12;
    const d = this.showcaseDist;
    const look = new Vector3(this.showcasePos.x, this.showcaseHeight, this.showcasePos.z);
    return {
      pos: new Vector3(look.x + Math.sin(sway) * d, look.y + 0.35 + d * 0.12, look.z + Math.cos(sway) * d),
      look,
      fov: 34,
      shift: this.showcaseShift,
    };
  }

  private finishPose(): Pose {
    const f = this.finishFocus;
    const d = this.finishDist;
    const p = 0.42;
    return {
      pos: new Vector3(f.x, 1 + Math.sin(p) * d, f.z + Math.cos(p) * d),
      look: new Vector3(f.x, 1.1, f.z),
      fov: 36,
      shift: this.finishShift,
    };
  }

  update(dt: number, a: Vector3, b: Vector3): void {
    this.t += dt;
    let target: Pose;
    if (this.mode === 'battle' || this.mode === 'intro') target = this.battlePose(a, b, dt);
    else if (this.mode === 'finish') target = this.finishPose();
    else target = this.showcasePose();

    if (this.from && this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / this.blendDur);
      const k = ease.inOutCubic(this.blend);
      this.cur.pos.copy(this.from.pos).lerp(target.pos, k);
      this.cur.look.copy(this.from.look).lerp(target.look, k);
      this.cur.fov = this.from.fov + (target.fov - this.from.fov) * k;
      this.cur.shift = this.from.shift + (target.shift - this.from.shift) * k;
    } else {
      const rate = this.mode === 'finish' ? 3 : 8;
      this.cur.pos.x = damp(this.cur.pos.x, target.pos.x, rate, dt);
      this.cur.pos.y = damp(this.cur.pos.y, target.pos.y, rate, dt);
      this.cur.pos.z = damp(this.cur.pos.z, target.pos.z, rate, dt);
      this.cur.look.x = damp(this.cur.look.x, target.look.x, rate, dt);
      this.cur.look.y = damp(this.cur.look.y, target.look.y, rate, dt);
      this.cur.look.z = damp(this.cur.look.z, target.look.z, rate, dt);
      this.cur.fov = damp(this.cur.fov, target.fov, 4, dt);
      this.cur.shift = damp(this.cur.shift, target.shift, 4, dt);
    }

    // shake & punch
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this.punch = Math.max(0, this.punch - dt * 4);
    const s = this.trauma * this.trauma;
    const t = this.t;
    const ox = (Math.sin(t * 47.3) + Math.sin(t * 23.1) * 0.5) * s * 0.35;
    const oy = (Math.sin(t * 39.7 + 1.3) + Math.sin(t * 17.9) * 0.5) * s * 0.3;
    const cam = this.r.camera;
    cam.position.set(this.cur.pos.x + ox, this.cur.pos.y + oy, this.cur.pos.z);
    cam.lookAt(this.cur.look.x + ox * 0.4, this.cur.look.y + oy * 0.4, this.cur.look.z);
    cam.rotateZ((Math.sin(t * 31.1) * s) * 0.03);
    cam.fov = this.cur.fov - this.punch * 2.2;
    this.r.viewShift = this.cur.shift * this.r.size.h;
    this.r.updateProjection();
  }
}
