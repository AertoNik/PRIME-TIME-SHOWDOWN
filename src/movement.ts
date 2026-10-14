import { WEAPONS } from './data';
import { preferredRange } from './ai';
import type { Fighter } from './combat';
export const clampX = (x: number) => Math.max(-4.1, Math.min(4.1, x));
export const clampZ = (z: number) => Math.max(-4.5, Math.min(4.5, z));
export function sidestep(f: Fighter, other: Fighter, length: number) {
  const dx = f.x - other.x, dz = f.z - other.z, d = Math.hypot(dx, dz) || 1;
  const candidates = [-1, 1].map(sign => ({ x: clampX(f.x - dz / d * length * sign), z: clampZ(f.z + dx / d * length * sign) }));
  // Prefer the direction with more room, rather than dashing into a wall.
  const to = candidates.sort((a, b) => Math.hypot(b.x - f.x, b.z - f.z) - Math.hypot(a.x - f.x, a.z - f.z))[0];
  f.x = to.x; f.z = to.z;
}
export function moveFighter(f: Fighter, other: Fighter, elapsed: number, dt: number) {
  const dx = other.x - f.x, dz = other.z - f.z, d = Math.hypot(dx, dz) || 1;
  const desired = preferredRange(WEAPONS[f.weapon].range, f.tactic);
  const radial = Math.max(-1.2, Math.min(1.2, (d - desired) * 0.95));
  const phase = elapsed * (f.tactic === 'evasive' ? 1.65 : 1.05) + f.movePhase;
  const lateral = (0.55 + Math.abs(Math.sin(phase * 0.65)) * 0.45) * (Math.sin(phase) >= 0 ? 1 : -1);
  const speed = (f.tactic === 'evasive' ? 2.1 : 1.85) * (f.dodge > 0 ? 1.65 : 1) * (f.overdrive > 0 ? 1.12 : 1);
  // Inward steering avoids corner pinning while retaining weapon-specific ranges.
  const wallX = Math.abs(f.x) > 3.35 ? -Math.sign(f.x) * (Math.abs(f.x) - 3.35) * 2.2 : 0;
  const wallZ = Math.abs(f.z) > 3.75 ? -Math.sign(f.z) * (Math.abs(f.z) - 3.75) * 2.2 : 0;
  const ox = f.x, oz = f.z;
  f.x = clampX(f.x + (dx / d * radial - dz / d * lateral + wallX) * speed * dt);
  f.z = clampZ(f.z + (dz / d * radial + dx / d * lateral + wallZ) * speed * dt);
  f.vx = (f.x - ox) / dt; f.vz = (f.z - oz) / dt;
  f.speed = Math.hypot(f.vx, f.vz); f.stride += f.speed * dt * 8;
  f.intent = f.dodge > 0 ? 'evade' : radial > 0.3 ? 'advance' : radial < -0.3 ? 'retreat' : 'strafe';
}
