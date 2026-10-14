import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { Fighter } from './combat';

export const HERO_HEIGHT = 2.45;
export const HERO_FLOOR = 0.045;
export function heroModelUrl(base = import.meta.env.BASE_URL) {
  return `${base.endsWith('/') ? base : `${base}/`}models/hero_base.glb`;
}
export type HeroLoader = (url: string) => Promise<GLTF>;
export const loadHeroModel: HeroLoader = url => new GLTFLoader().loadAsync(url);

// GLB resources belong to this visual only; procedural/shared game resources do not.
export function disposeHeroScene(scene: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>(), skeletons = new Set<THREE.Skeleton>();
  scene.traverse(o => {
    if (o instanceof THREE.Mesh) {
      geometries.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
    }
    if (o instanceof THREE.SkinnedMesh) skeletons.add(o.skeleton);
  });
  for (const m of materials) for (const value of Object.values(m)) if (value instanceof THREE.Texture) textures.add(value);
  textures.forEach(t => t.dispose()); materials.forEach(m => m.dispose());
  geometries.forEach(g => g.dispose()); skeletons.forEach(s => s.dispose());
}

type Motion = 'idle' | 'move' | 'attack' | 'hit' | 'dodge' | 'victory' | 'death';
const clipNames: Record<Motion, RegExp> = {
  idle: /idle|stand|breath/i, move: /walk|run|jog|locomotion/i,
  attack: /shoot|fire|attack|recoil/i, hit: /hit|hurt|damage/i,
  dodge: /dodge|dash|evade/i, victory: /win|victory|celebrat/i, death: /death|die|defeat/i,
};

export class HeroVisual {
  readonly root = new THREE.Group();
  readonly normalized = new THREE.Group();
  readonly weaponSocket = new THREE.Group();
  readonly bones = new Map<string, THREE.Bone>();
  readonly mixer: THREE.AnimationMixer | null;
  readonly clips: string[];
  readonly scale: number;
  readonly handBone: string | null;
  private rest = new Map<string, THREE.Quaternion>();
  private actions = new Map<Motion, THREE.AnimationAction>();
  private action?: THREE.AnimationAction;
  private rotation = new THREE.Quaternion();
  private axis = new THREE.Vector3(1, 0, 0);
  private disposed = false;

  constructor(readonly gltf: GLTF) {
    this.root.name = 'HeroGLB'; this.normalized.name = 'HeroScaleAndGround';
    this.root.add(this.normalized); this.normalized.add(gltf.scene);
    gltf.scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(gltf.scene, true);
    const size = bounds.getSize(new THREE.Vector3());
    if (bounds.isEmpty() || !Number.isFinite(size.length()) || size.y < 0.001) throw new Error('Hero GLB has invalid bounds');
    this.scale = HERO_HEIGHT / size.y;
    this.normalized.scale.setScalar(this.scale);
    this.normalized.position.set(-(bounds.min.x + bounds.max.x) * 0.5 * this.scale,
      HERO_FLOOR - bounds.min.y * this.scale, -(bounds.min.z + bounds.max.z) * 0.5 * this.scale);
    gltf.scene.traverse(o => {
      if (o instanceof THREE.Bone) this.bones.set(o.name, o);
      if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    this.clips = gltf.animations.map(c => c.name);
    this.mixer = gltf.animations.length ? new THREE.AnimationMixer(gltf.scene) : null;
    if (this.mixer) {
      for (const [state, pattern] of Object.entries(clipNames) as [Motion, RegExp][]) {
        const clip = gltf.animations.find(c => pattern.test(c.name));
        if (clip) {
          const action = this.mixer.clipAction(clip);
          if (['attack', 'hit', 'dodge', 'death'].includes(state)) { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; }
          this.actions.set(state, action);
        }
      }
      // Unknown names can still be previewed through playClip; never play an arbitrary attack as idle.
      this.playMotion('idle');
    } else {
      // This asset has a deformation rig but no authored clips. Pose actual joints, not the entire mesh as a walk cycle.
      this.aimBone('upper_arm.R', new THREE.Vector3(-0.18, -0.65, 0.68));
      this.aimBone('forearm.R', new THREE.Vector3(0, 0.04, 1));
      this.aimBone('upper_arm.L', new THREE.Vector3(0.25, -0.8, 0.25));
      this.aimBone('forearm.L', new THREE.Vector3(-0.35, 0.05, 0.9));
    }
    for (const [name, bone] of this.bones) this.rest.set(name, bone.quaternion.clone());
    const hand = [...this.bones.values()].find(b => /^(hand[._ -]?r|right[._ -]?hand|mixamorig:?righthand)$/i.test(b.name));
    this.handBone = hand?.name ?? null;
    this.weaponSocket.name = 'HeroWeaponSocket';
    this.root.updateMatrixWorld(true);
    if (hand) {
      hand.add(this.weaponSocket);
      this.weaponSocket.position.set(0, 0.065, 0);
      // Keep existing gun geometry in game units despite the imported model's normalization.
      const handScale = hand.getWorldScale(new THREE.Vector3());
      this.weaponSocket.scale.set(1 / handScale.x, 1 / handScale.y, 1 / handScale.z);
      this.weaponSocket.quaternion.copy(hand.getWorldQuaternion(new THREE.Quaternion())).invert();
    } else {
      this.root.add(this.weaponSocket); this.weaponSocket.position.set(0.44, 1.55, 0.45);
    }
  }

  private aimBone(name: string, direction: THREE.Vector3) {
    const bone = this.bone(name); if (!bone?.parent) return;
    this.root.updateMatrixWorld(true);
    const world = bone.getWorldQuaternion(new THREE.Quaternion());
    const current = new THREE.Vector3(0, 1, 0).applyQuaternion(world);
    const desired = direction.normalize().transformDirection(this.root.matrixWorld);
    world.premultiply(new THREE.Quaternion().setFromUnitVectors(current, desired));
    bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
  }
  private bone(name: string) { return this.bones.get(name) ?? this.bones.get(name.replace(/\./g, '')); }

  attachWeapon(gun: THREE.Group) {
    this.weaponSocket.add(gun); gun.position.set(0, 0.1, 0.08); gun.rotation.set(0, 0, 0); gun.scale.setScalar(1);
  }
  /** Explicit preview hook for future Blender clips whose names are not recognized automatically. */
  playClip(name: string) {
    const clip = this.gltf.animations.find(c => c.name === name);
    if (!this.mixer || !clip) return false;
    this.transition(this.mixer.clipAction(clip)); return true;
  }
  private transition(next: THREE.AnimationAction) {
    if (next === this.action) return;
    next.reset().setEffectiveWeight(1).play();
    if (this.action) this.action.crossFadeTo(next, 0.15, false);
    this.action = next;
  }
  private playMotion(motion: Motion) {
    const next = this.actions.get(motion) ?? this.actions.get('idle');
    if (next) this.transition(next);
  }
  private turn(name: string, angle: number, axis: 'x' | 'z' = 'x') {
    const bone = this.bone(name), rest = bone && this.rest.get(bone.name); if (!bone || !rest) return;
    this.axis.set(axis === 'x' ? 1 : 0, 0, axis === 'z' ? 1 : 0);
    bone.quaternion.copy(rest).multiply(this.rotation.setFromAxisAngle(this.axis, angle));
  }
  update(f: Fighter, time: number, victory: boolean, dt: number) {
    const motion: Motion = f.hp <= 0 ? 'death' : victory ? 'victory' : f.hit > 0.12 ? 'hit' :
      f.dodge > 0 ? 'dodge' : f.recoil > 0.05 || f.windup > 0 ? 'attack' : f.speed > 0.15 ? 'move' : 'idle';
    if (this.mixer) { this.playMotion(motion); this.mixer.update(Math.max(0, dt)); }
    else {
      const moving = f.hp > 0 && !victory ? Math.min(1, f.speed / 2) : 0, step = Math.sin(f.stride);
      this.turn('thigh.L', step * 0.28 * moving); this.turn('thigh.R', -step * 0.28 * moving);
      this.turn('shin.L', Math.max(0, -step) * 0.3 * moving); this.turn('shin.R', Math.max(0, step) * 0.3 * moving);
      this.turn('chest', f.hp <= 0 ? 0.65 : -f.hit * 0.3 + Math.sin(time * 2.4) * 0.012);
      this.turn('upper_arm.R', -f.recoil * 0.5 - (f.windup > 0 ? 0.06 : 0));
      this.turn('upper_arm.L', victory ? -1.5 + Math.sin(time * 4) * 0.15 : 0);
    }
    this.root.rotation.z = f.hp <= 0 ? -0.35 : f.dodge > 0 ? -0.12 : 0;
  }
  reset() { this.root.rotation.set(0, 0, 0); if (this.mixer) { this.mixer.stopAllAction(); this.action = undefined; this.playMotion('idle'); } }
  dispose() {
    if (this.disposed) return; this.disposed = true;
    this.mixer?.stopAllAction(); this.mixer?.uncacheRoot(this.gltf.scene);
    this.weaponSocket.clear(); this.root.removeFromParent(); disposeHeroScene(this.gltf.scene);
  }
}
