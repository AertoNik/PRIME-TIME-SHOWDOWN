import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  TorusGeometry,
} from 'three';
import { damp } from '../core/math';
import { defaultInput, type AnimInput } from './FighterAnimator';
import type { CachedFighter, ModelCache } from './ModelCache';
import { glowTexture } from './textures';

/** Menu presentation: the selected fighter on a glowing stage pedestal. */
export class Showcase {
  readonly group = new Group();
  private models: ModelCache;
  private current: CachedFighter | null = null;
  look = '';
  private input: AnimInput = defaultInput();
  private yaw = 0;
  private yawVel = 0;
  private dragging = false;
  private ringMat: MeshBasicMaterial;
  private glowMat: MeshBasicMaterial;
  private cheerT = -1;
  private t = 0;
  /** Alpha 1.8.8 — the fitting room's dash preview: time into the move (-1: standing). */
  private slideT = -1;
  private slideFrom = 0;
  private slideTo = 0;

  constructor(models: ModelCache) {
    this.models = models;
    const ped = new Mesh(new CylinderGeometry(1.15, 1.3, 0.22, 40), new MeshStandardMaterial({ color: 0x141a3c, roughness: 0.3, metalness: 0.7 }));
    ped.position.y = 0.11;
    ped.receiveShadow = true;
    this.group.add(ped);
    this.ringMat = new MeshBasicMaterial({ color: new Color(0x22f0e0).multiplyScalar(2.2) });
    const ring = new Mesh(new TorusGeometry(1.2, 0.035, 8, 64), this.ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.22;
    this.group.add(ring);
    this.glowMat = new MeshBasicMaterial({ map: glowTexture(), color: new Color(0x22f0e0), transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0.55 });
    const glow = new Mesh(new PlaneGeometry(4.2, 4.2), this.glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.02;
    this.group.add(glow);
    this.input.combat = false;
  }

  show(look: string, accent?: string): void {
    this.group.visible = true;
    if (accent) {
      this.ringMat.color.set(accent).multiplyScalar(2.2);
      this.glowMat.color.set(accent);
    }
    if (look === this.look && this.current && this.current.rig.root.parent === this.group) return;
    if (this.current && this.current.rig.root.parent === this.group) this.group.remove(this.current.rig.root);
    this.look = look;
    this.current = this.models.get(look);
    const rig = this.current.rig;
    rig.root.visible = true;
    this.group.add(rig.root);
    this.current.anim.reset(this.yaw);
    rig.root.position.set(0, 0.22, 0);
    this.cheerT = -1;
    this.slideT = -1;
  }

  hide(): void {
    this.group.visible = false;
  }

  setDragging(d: boolean): void {
    this.dragging = d;
  }

  drag(dx: number): void {
    this.yawVel = dx * 0.6;
    this.yaw += dx * 0.012;
  }

  resetYaw(): void {
    this.yawVel = 0;
  }

  /**
   * Alpha 1.8.8 (PRIME SHOP fitting room): a dash across the pedestal from `fromX` to `toX`, a short
   * hold, then a glide back to the middle — so the DASH cosmetics can be previewed without a match.
   */
  demoDash(fromX: number, toX: number): void {
    if (!this.current) return;
    this.slideFrom = fromX;
    this.slideTo = toX;
    this.slideT = 0;
    this.current.rig.root.position.x = fromX;
    this.current.anim.dash(Math.sign(toX - fromX) || 1, 0);
  }

  cheer(): void {
    if (!this.current) return;
    this.current.anim.victory();
    this.cheerT = 2.6;
  }

  update(dt: number): void {
    if (!this.group.visible || !this.current) return;
    this.t += dt;
    if (!this.dragging) {
      this.yaw += this.yawVel * dt * 0.02;
      this.yawVel = damp(this.yawVel, 0, 4, dt);
      if (Math.abs(this.yawVel) < 2) this.yaw = damp(this.yaw, Math.round(this.yaw / (Math.PI * 2)) * Math.PI * 2, 2, dt);
    }
    if (this.cheerT > 0) {
      this.cheerT -= dt;
      // ease back into the idle instead of snapping out of the pose
      if (this.cheerT <= 0) this.current.anim.endVictory();
    }
    this.input.facing = this.yaw;
    this.input.x = 0;
    this.input.z = 0;
    this.current.anim.update(dt, this.input);
    const root = this.current.rig.root;
    root.position.y = 0.22;
    if (this.slideT >= 0) {
      // 0.18 s across, a beat at the far side, then back to the middle
      this.slideT += dt;
      const t = this.slideT;
      if (t < 0.18) root.position.x = this.slideFrom + (this.slideTo - this.slideFrom) * (1 - Math.pow(1 - t / 0.18, 3));
      else if (t < 0.75) root.position.x = this.slideTo;
      else root.position.x = damp(root.position.x, 0, 5, dt);
      if (t > 1.8) {
        root.position.x = 0;
        this.slideT = -1;
      }
    }
  }
}
