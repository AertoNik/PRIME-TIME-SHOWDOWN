import * as THREE from 'three';
import type { CombatEvent } from './combat';
import { WEAPONS, CARDS } from './data';
interface Particle { mesh: THREE.Mesh; life: number; total: number; vx: number; vy: number; vz: number }
interface Wave { mesh: THREE.Mesh; life: number; total: number; size: number }
export class Effects {
  group = new THREE.Group();
  private geometry = new THREE.IcosahedronGeometry(0.065, 0);
  private particles: Particle[] = [];
  private beams: { mesh: THREE.Mesh; life: number; total: number }[] = [];
  private waves: Wave[] = [];
  private lights: { light: THREE.PointLight; life: number }[] = [];
  private beamGeometry = new THREE.CylinderGeometry(1, 1, 1, 5);
  private waveGeometry = new THREE.RingGeometry(0.78, 1, 32);
  private smokeGeometry = new THREE.IcosahedronGeometry(0.5, 1);
  private start = new THREE.Vector3(); private end = new THREE.Vector3();
  private direction = new THREE.Vector3(); private up = new THREE.Vector3(0, 1, 0);
  smokes: THREE.Group[] = [];
  quality = 1;
  shake = 0;
  punch = 0;
  constructor() {
    for (let i = 0; i < 120; i++) {
      const m = new THREE.Mesh(this.geometry, new THREE.MeshBasicMaterial({ toneMapped: false, color: 0xffc75e, transparent: true, depthWrite: false }));
      m.visible = false; this.group.add(m); this.particles.push({ mesh: m, life: 0, total: 1, vx: 0, vy: 0, vz: 0 });
    }
    for (let i = 0; i < 20; i++) {
      const m = new THREE.Mesh(this.beamGeometry, new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.visible = false; this.group.add(m); this.beams.push({ mesh: m, life: 0, total: 0.1 });
    }
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(this.waveGeometry, new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.visible = false; this.group.add(m); this.waves.push({ mesh: m, life: 0, total: 1, size: 1 });
    }
    for (let i = 0; i < 2; i++) { const light = new THREE.PointLight(0xffba50, 0, 4, 2); this.group.add(light); this.lights.push({ light, life: 0 }); }
    for (let s = 0; s < 2; s++) {
      const g = new THREE.Group();
      for (let i = 0; i < 7; i++) {
        const m = new THREE.Mesh(this.smokeGeometry, new THREE.MeshBasicMaterial({ toneMapped: false, color: 0xa8a2c5, transparent: true, opacity: 0.17, depthWrite: false }));
        m.position.set(Math.sin(i * 2) * 0.85, 0.4 + i * 0.19, Math.cos(i * 2) * 0.85); m.scale.setScalar(1.15 + i * 0.08); g.add(m);
      }
      g.visible = false; this.group.add(g); this.smokes.push(g);
    }
  }
  burst(x: number, z: number, color: number, count: number, y = 1) {
    let n = Math.floor(count * this.quality);
    for (const p of this.particles) {
      if (p.life > 0) continue;
      p.life = p.total = 0.24 + Math.random() * 0.32; p.vx = (Math.random() - 0.5) * 7; p.vy = 2 + Math.random() * 4; p.vz = (Math.random() - 0.5) * 7;
      p.mesh.position.set(x, y, z); p.mesh.scale.setScalar(0.8 + Math.random() * 1.1);
      (p.mesh.material as THREE.MeshBasicMaterial).color.setHex(color); p.mesh.visible = true; if (--n <= 0) break;
    }
  }
  wave(x: number, z: number, color: number, size = 1.5, ground = false) {
    const w = this.waves.find(w => w.life <= 0); if (!w) return;
    w.life = w.total = 0.45; w.size = size; w.mesh.position.set(x, ground ? 0.075 : 1.5, z);
    w.mesh.rotation.set(ground ? -Math.PI / 2 : -0.45, ground ? 0 : 0.25, 0);
    (w.mesh.material as THREE.MeshBasicMaterial).color.setHex(color); w.mesh.visible = true;
  }
  trace(x: number, z: number, tx: number, tz: number, color: number, width: number, life: number, y = 1.6) {
    const b = this.beams.find(b => b.life <= 0); if (!b) return;
    this.start.set(x, y, z); this.end.set(tx, y, tz); this.direction.copy(this.end).sub(this.start);
    b.mesh.position.copy(this.start).add(this.end).multiplyScalar(0.5);
    const length = this.direction.length();
    b.mesh.quaternion.setFromUnitVectors(this.up, this.direction.normalize());
    b.mesh.scale.set(width, length, width); (b.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    b.life = b.total = life; b.mesh.visible = true;
  }
  flash(x: number, z: number, color: number) {
    const f = this.lights.find(f => f.life <= 0) || this.lights[0];
    f.light.position.set(x, 1.6, z); f.light.color.setHex(color); f.life = 0.18;
  }
  event(e: CombatEvent) {
    if (e.type === 'shot') {
      const color = e.heavy ? 0xffcc60 : WEAPONS[e.weapon!].color;
      const count = e.weapon === 'shotgun' && !e.heavy ? 3 : 1;
      for (let i = 0; i < count; i++) this.trace(e.x, e.z, (e.tx ?? 0) + (e.hit ? 0 : 0.85) + (i - (count - 1) / 2) * 0.3, e.tz ?? 0, color, e.heavy ? e.text ? 0.12 : 0.085 : 0.027, e.heavy ? 0.18 : 0.1);
      this.burst(e.x, e.z, color, e.heavy ? 16 : 5, 1.65);
      if (e.heavy) { this.wave(e.x, e.z, color, 1.2); this.flash(e.x, e.z, color); this.punch = 0.12; }
    }
    if (e.type === 'hit') {
      const color = e.blocked ? 0x76d8ff : e.heavy ? 0xffcb58 : 0xffe8a0;
      this.burst(e.x, e.z, color, e.heavy ? 28 : 9, 1.55);
      if (e.heavy || e.blocked) this.wave(e.x, e.z, color, e.heavy ? 1.5 : 0.8);
      if (e.heavy) { this.shake = e.blocked ? 0.1 : 0.25; this.flash(e.x, e.z, color); }
    }
    if (e.type === 'card') {
      const color = new THREE.Color(CARDS[e.card!].color).getHex();
      this.burst(e.x, e.z, color, 18, 0.5); this.wave(e.x, e.z, color, e.card === 'shield' ? 1.8 : 1.3, true);
      if (e.card === 'shock') { this.trace(e.x, e.z, e.tx!, e.tz!, color, 0.055, 0.22); this.wave(e.tx!, e.tz!, color, 1.4); this.flash(e.tx!, e.tz!, color); }
    }
    if (e.type === 'evade') {
      if (e.text === 'DASH TRAIL') this.trace(e.x, e.z, e.tx!, e.tz!, 0x6cf4d4, 0.12, 0.25, 0.15);
      else this.wave(e.x, e.z, 0x69e6d4, 0.8, true);
    }
    if (e.type === 'combo') { this.burst(e.x, e.z, 0xffd355, 26, 1.7); this.wave(e.x, e.z, 0xffd355, 2.2, true); this.shake = 0.27; this.flash(e.x, e.z, 0xffd355); }
    if (e.type === 'finish') this.wave(e.x, e.z, 0xffd355, 3, true);
  }
  update(dt: number) {
    this.shake = Math.max(0, this.shake - dt); this.punch = Math.max(0, this.punch - dt);
    for (const p of this.particles) if (p.life > 0) {
      p.life -= dt; p.mesh.visible = p.life > 0; p.mesh.position.x += p.vx * dt; p.mesh.position.y += p.vy * dt; p.mesh.position.z += p.vz * dt; p.vy -= dt * 12;
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, p.life / p.total);
    }
    for (const b of this.beams) if (b.life > 0) { b.life -= dt; b.mesh.visible = b.life > 0; (b.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, b.life / b.total); }
    for (const w of this.waves) if (w.life > 0) {
      w.life -= dt; const progress = 1 - Math.max(0, w.life / w.total); w.mesh.visible = w.life > 0;
      w.mesh.scale.setScalar(0.15 + progress * w.size); (w.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - progress) * 0.8;
    }
    for (const f of this.lights) { f.life = Math.max(0, f.life - dt); f.light.intensity = f.life * (this.quality < 1 ? 0 : 35); }
  }
  reset() {
    for (const p of this.particles) { p.life = 0; p.mesh.visible = false; }
    for (const b of this.beams) { b.life = 0; b.mesh.visible = false; }
    for (const w of this.waves) { w.life = 0; w.mesh.visible = false; }
    for (const f of this.lights) { f.life = 0; f.light.intensity = 0; }
    for (const s of this.smokes) s.visible = false;
    this.shake = 0; this.punch = 0;
  }
  dispose() { this.geometry.dispose(); this.beamGeometry.dispose(); this.waveGeometry.dispose(); this.smokeGeometry.dispose(); this.group.traverse(o => { if (o instanceof THREE.Mesh) (o.material as THREE.Material).dispose(); }); }
}
