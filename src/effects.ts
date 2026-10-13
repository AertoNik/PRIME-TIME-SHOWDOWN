import * as THREE from 'three';
import type { CombatEvent } from './combat';
import { WEAPONS } from './data';
interface Particle { mesh: THREE.Mesh; life: number; total: number; vx: number; vy: number; vz: number }
export class Effects {
  group = new THREE.Group();
  private geometry = new THREE.IcosahedronGeometry(0.065, 0);
  private particles: Particle[] = [];
  private beams: { mesh: THREE.Mesh; life: number }[] = [];
  private beamGeometry = new THREE.CylinderGeometry(1, 1, 1, 5);
  private smokeGeometry = new THREE.IcosahedronGeometry(0.5, 1);
  smokes: THREE.Group[] = [];
  quality = 1;
  shake = 0;
  constructor() {
    for (let i = 0; i < 100; i++) { const m = new THREE.Mesh(this.geometry, new THREE.MeshBasicMaterial({ color: 0xffc75e, transparent: true })); m.visible = false; this.group.add(m); this.particles.push({ mesh: m, life: 0, total: 1, vx: 0, vy: 0, vz: 0 }); }
    for (let i = 0; i < 18; i++) { const m = new THREE.Mesh(this.beamGeometry, new THREE.MeshBasicMaterial({ transparent: true })); m.visible = false; this.group.add(m); this.beams.push({ mesh: m, life: 0 }); }
    for (let s = 0; s < 2; s++) { const g = new THREE.Group(); for (let i = 0; i < 7; i++) { const m = new THREE.Mesh(this.smokeGeometry, new THREE.MeshBasicMaterial({ color: 0x9d9bba, transparent: true, opacity: 0.12, depthWrite: false })); m.position.set(Math.sin(i * 2) * 0.7, 0.4 + i * 0.18, Math.cos(i * 2) * 0.7); m.scale.setScalar(1 + i * 0.08); g.add(m); } g.visible = false; this.group.add(g); this.smokes.push(g); }
  }
  burst(x: number, z: number, color: number, count: number, y = 1) {
    let n = Math.floor(count * this.quality);
    for (const p of this.particles) { if (p.life > 0) continue; p.life = p.total = 0.25 + Math.random() * 0.35; p.vx = (Math.random() - 0.5) * 6; p.vy = 2 + Math.random() * 3; p.vz = (Math.random() - 0.5) * 6; p.mesh.position.set(x, y, z); p.mesh.scale.setScalar(0.8 + Math.random()); (p.mesh.material as THREE.MeshBasicMaterial).color.setHex(color); p.mesh.visible = true; if (--n <= 0) break; }
  }
  event(e: CombatEvent) {
    if (e.type === 'shot') {
      const count = e.weapon === 'shotgun' && !e.heavy ? 3 : 1;
      for (let i = 0; i < count; i++) { const b = this.beams.find(b => b.life <= 0); if (!b) break; const start = new THREE.Vector3(e.x, 1.55, e.z); const end = new THREE.Vector3((e.tx ?? 0) + (e.hit ? 0 : 0.7) + (i - (count - 1) / 2) * 0.22, 1.5, e.tz ?? 0); const direction = end.clone().sub(start); b.mesh.position.copy(start.add(end).multiplyScalar(0.5)); b.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize()); const width = e.heavy ? 0.055 : 0.018; b.mesh.scale.set(width, direction.length(), width); (b.mesh.material as THREE.MeshBasicMaterial).color.setHex(e.heavy ? 0xffd070 : WEAPONS[e.weapon!].color); b.life = 0.11; b.mesh.visible = true; }
      this.burst(e.x, e.z, e.heavy ? 0xffba40 : WEAPONS[e.weapon!].color, e.heavy ? 12 : 4, 1.35);
    }
    if (e.type === 'hit') { this.burst(e.x, e.z, e.heavy ? 0xffbe45 : 0xf8f0c9, e.heavy ? 22 : 7); if (e.heavy) this.shake = 0.22; }
    if (e.type === 'card') this.burst(e.x, e.z, e.card === 'shock' ? 0xcf8fff : e.card === 'shield' ? 0x67c5ff : 0x68f1cf, 20, 0.5);
    if (e.type === 'combo') { this.burst(e.x, e.z, 0xffd355, 28, 1.8); this.shake = 0.28; }
  }
  update(dt: number) {
    this.shake = Math.max(0, this.shake - dt);
    for (const p of this.particles) if (p.life > 0) { p.life -= dt; p.mesh.visible = p.life > 0; p.mesh.position.x += p.vx * dt; p.mesh.position.y += p.vy * dt; p.mesh.position.z += p.vz * dt; p.vy -= dt * 12; (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, p.life / p.total); }
    for (const b of this.beams) if (b.life > 0) { b.life -= dt; b.mesh.visible = b.life > 0; (b.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, b.life / 0.11); }
  }
  reset() { for (const p of this.particles) { p.life = 0; p.mesh.visible = false; } for (const b of this.beams) { b.life = 0; b.mesh.visible = false; } for (const s of this.smokes) s.visible = false; this.shake = 0; }
  dispose() { this.geometry.dispose(); this.beamGeometry.dispose(); this.smokeGeometry.dispose(); this.group.traverse(o => { if (o instanceof THREE.Mesh) (o.material as THREE.Material).dispose(); }); }
}
