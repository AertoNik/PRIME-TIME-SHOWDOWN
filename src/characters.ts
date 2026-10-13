import * as THREE from 'three';
import type { Fighter } from './combat';
import type { WeaponId } from './data';
const materials = new Map<string, THREE.MeshStandardMaterial>();
const shapes = new Map<string, THREE.BufferGeometry>();
export function material(color: number, metalness = 0, emissive = false) { const key = `${color}:${metalness}:${emissive}`; let mat = materials.get(key); if (!mat) { mat = new THREE.MeshStandardMaterial({ color, roughness: metalness ? 0.38 : 0.8, metalness, emissive: emissive ? color : 0, emissiveIntensity: emissive ? 1.5 : 0 }); materials.set(key, mat); } return mat; }
export function box(w: number, h: number, d: number) { const key = `b${w},${h},${d}`; let g = shapes.get(key); if (!g) { g = new THREE.BoxGeometry(w, h, d); shapes.set(key, g); } return g; }
export function mesh(g: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0, metal = 0, neon = false) { const m = new THREE.Mesh(g, material(color, metal, neon)); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m; }
export function cube(parent: THREE.Object3D, color: number, w: number, h: number, d: number, x = 0, y = 0, z = 0, metal = 0, neon = false) { const m = mesh(box(w, h, d), color, x, y, z, metal, neon); parent.add(m); return m; }
export function cylinder(parent: THREE.Object3D, color: number, rt: number, rb: number, height: number, x = 0, y = 0, z = 0, metal = 0) { const key = `c${rt},${rb},${height}`; let g = shapes.get(key); if (!g) { g = new THREE.CylinderGeometry(rt, rb, height, 8); shapes.set(key, g); } const m = mesh(g, color, x, y, z, metal); parent.add(m); return m; }
export class Character {
  root = new THREE.Group();
  body = new THREE.Group();
  leftLeg = new THREE.Group(); rightLeg = new THREE.Group();
  leftArm = new THREE.Group(); rightArm = new THREE.Group();
  gun = new THREE.Group();
  shield: THREE.Mesh;
  ring: THREE.Mesh;
  halo: THREE.Mesh;
  constructor(public enemy = false) {
    const jacket = enemy ? 0x973748 : 0x1e6666, accent = enemy ? 0xff7187 : 0xf5b844, skin = enemy ? 0xc38667 : 0xdba477;
    this.root.add(this.body); this.body.position.y = 0.92;
    // Broad cropped jacket, fitted trousers, reinforced shoulders and large sneakers.
    const torso = cylinder(this.body, jacket, 0.43, 0.31, 0.67, 0, 0.49); torso.scale.z = 0.72;
    cube(this.body, 0x151f2b, 0.37, 0.5, 0.08, 0, 0.49, 0.29);
    for (const s of [-1, 1]) { const lapel = cube(this.body, accent, 0.1, 0.48, 0.09, s * 0.21, 0.53, 0.27); lapel.rotation.z = s * 0.2; cube(this.body, 0x26313e, 0.22, 0.17, 0.1, s * 0.24, 0.27, 0.28); }
    cube(this.body, 0x101822, 0.64, 0.13, 0.46, 0, 0.13);
    cube(this.body, 0xd5d1b9, 0.15, 0.13, 0.07, 0, 0.13, 0.26, 0.5);
    for (const [leg, sign] of [[this.leftLeg, -1], [this.rightLeg, 1]] as const) {
      this.root.add(leg); leg.position.set(sign * 0.22, 0.95, 0);
      cube(leg, 0x28343e, 0.29, 0.61, 0.3, 0, -0.29);
      cube(leg, 0x172631, 0.3, 0.2, 0.1, 0, -0.43, 0.17);
      cube(leg, 0x111b24, 0.33, 0.25, 0.49, 0, -0.79, 0.08);
      cube(leg, accent, 0.34, 0.07, 0.5, 0, -0.88, 0.08);
    }
    for (const [arm, sign] of [[this.leftArm, -1], [this.rightArm, 1]] as const) {
      this.body.add(arm); arm.position.set(sign * 0.44, 0.74, 0);
      cylinder(arm, jacket, 0.19, 0.16, 0.36, 0, -0.12);
      cube(arm, 0x303c49, 0.34, 0.18, 0.36, 0, 0.03, 0, 0.35);
      cube(arm, accent, 0.2, 0.05, 0.37, 0, 0.13);
      cylinder(arm, skin, 0.13, 0.15, 0.33, 0, -0.43);
      cube(arm, 0x172631, 0.28, 0.23, 0.27, 0, -0.6);
    }
    this.rightArm.rotation.x = -1.35; this.leftArm.rotation.x = -0.65; this.leftArm.rotation.z = -0.22;
    // Sculpted head: angular jaw, ears, nose, brows, hair and luminous visor.
    cylinder(this.body, skin, 0.13, 0.14, 0.2, 0, 0.93);
    const head = new THREE.Group(); head.position.set(0, 1.18, 0); this.body.add(head);
    const skull = cylinder(head, skin, 0.28, 0.22, 0.43); skull.scale.z = 0.88;
    cube(head, skin, 0.38, 0.14, 0.3, 0, -0.16, 0.05);
    cube(head, 0x382924, 0.32, 0.045, 0.04, 0, -0.11, 0.235);
    cube(head, skin, 0.09, 0.12, 0.13, 0, -0.01, 0.26);
    cube(head, 0x122632, 0.48, 0.14, 0.08, 0, 0.08, 0.24, 0.3);
    cube(head, enemy ? 0xff6c85 : 0x65eed9, 0.38, 0.07, 0.09, 0, 0.09, 0.28, 0.5, true);
    const hair = cylinder(head, 0x1b2028, 0.26, 0.3, 0.16, 0, 0.24); hair.scale.z = 0.9;
    for (let i = 0; i < 4; i++) { const tuft = cube(head, enemy ? 0xeae0bf : 0x20252b, 0.12, 0.18 + i * 0.02, 0.13, 0, 0.34, -0.18 + i * 0.1); tuft.rotation.x = -0.25; }
    for (const s of [-1, 1]) cylinder(head, 0x252f3a, 0.1, 0.1, 0.1, s * 0.29, 0.02).rotation.z = Math.PI / 2;
    cube(head, accent, 0.04, 0.04, 0.24, 0.32, -0.05, 0.12);
    this.rightArm.add(this.gun); this.gun.position.set(0, -0.59, 0.1); this.gun.rotation.x = Math.PI / 2;
    this.setWeapon('pistol');
    this.shield = new THREE.Mesh(new THREE.SphereGeometry(1.12, 16, 12), new THREE.MeshBasicMaterial({ color: 0x68d9ff, transparent: true, opacity: 0.17, wireframe: true, depthWrite: false }));
    this.shield.position.y = 1.15; this.shield.scale.y = 1.2; this.root.add(this.shield); this.shield.visible = false;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.65, 0.72, 32), new THREE.MeshBasicMaterial({ color: enemy ? 0xff6988 : 0x64eed6, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = 0.025; this.root.add(this.ring);
    this.halo = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.025, 4, 18), new THREE.MeshBasicMaterial({ color: 0xd1a3ff }));
    this.halo.rotation.x = Math.PI / 2; this.halo.position.y = 2.7; this.halo.visible = false; this.root.add(this.halo);
  }
  setWeapon(id: WeaponId) { this.gun.clear(); const color = this.enemy ? 0xff7187 : 0xf7bd53; const length = id === 'pistol' ? 0.5 : id === 'shotgun' ? 0.85 : 0.95;
    cube(this.gun, 0x222e3b, 0.2, 0.24, length, 0, 0, length * 0.25, 0.6);
    cube(this.gun, color, 0.21, 0.1, length * 0.65, 0, 0.1, length * 0.25, 0.4);
    cube(this.gun, 0x101822, 0.13, 0.3, 0.17, 0, -0.17, -0.08);
    const barrel = cylinder(this.gun, 0x566372, 0.065, 0.065, 0.16, 0, 0.015, length * 0.78, 0.7); barrel.rotation.x = Math.PI / 2;
    if (id === 'carbine') for (let i = 0; i < 3; i++) cube(this.gun, 0x64f6de, 0.22, 0.05, 0.06, 0, 0.05, i * 0.16, 0.4, true);
    if (id === 'shotgun') cube(this.gun, 0x885844, 0.24, 0.18, 0.35, 0, -0.1, 0.4);
  }
  update(f: Fighter, other: Fighter, time: number, victory = false) {
    this.root.position.set(f.x, 0, f.z);
    this.root.rotation.y = Math.atan2(other.x - f.x, other.z - f.z);
    this.body.position.y = 0.92 + Math.abs(Math.sin(f.stride)) * 0.045;
    this.leftLeg.rotation.x = Math.sin(f.stride) * 0.28; this.rightLeg.rotation.x = -Math.sin(f.stride) * 0.28;
    this.body.rotation.z = f.hit > 0 ? Math.sin(f.hit * 35) * 0.14 : f.dodge > 0 ? -0.25 : Math.sin(time * 2) * 0.015;
    this.body.rotation.x = f.hit > 0 ? -f.hit * 0.4 : 0;
    this.rightArm.rotation.x = -1.35 + f.recoil * 1.8 - (f.windup > 0 ? 0.25 : 0);
    this.leftArm.rotation.x = victory ? -2.5 + Math.sin(time * 5) * 0.3 : -0.65;
    this.shield.visible = f.shield > 0; this.shield.rotation.y = time * 0.7;
    this.halo.visible = f.stun > 0; this.halo.rotation.z = time * 4;
    this.ring.scale.setScalar(f.windup > 0 ? 1.2 + Math.sin(time * 25) * 0.2 : 1);
    (this.ring.material as THREE.MeshBasicMaterial).color.setHex(f.windup > 0 ? 0xffb83e : this.enemy ? 0xff6988 : 0x64eed6);
    if (f.hp <= 0) { this.body.rotation.z = -0.8; this.body.position.y = 0.45; this.rightArm.rotation.x = -0.2; }
    if (victory) this.body.position.y += Math.max(0, Math.sin(time * 4)) * 0.18;
  }
  dispose() { for (const m of [this.shield, this.ring, this.halo]) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } }
}
export function disposeShared() { for (const m of materials.values()) m.dispose(); for (const g of shapes.values()) g.dispose(); materials.clear(); shapes.clear(); }
