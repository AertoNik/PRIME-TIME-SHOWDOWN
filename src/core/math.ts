export const TAU = Math.PI * 2;

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number): number => (b === a ? 0 : (v - a) / (b - a));

/** Frame-rate independent exponential smoothing. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function wrapAngle(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

export function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  return current + wrapAngle(target - current) * (1 - Math.exp(-lambda * dt));
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

export function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}

export const ease = {
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  inQuad: (t: number) => t * t,
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inCubic: (t: number) => t * t * t,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outExpo: (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  outBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  outElastic: (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  },
  outBounce: (t: number) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};

/** Small deterministic PRNG (mulberry32). */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length) % arr.length];
  }
  sign(): number {
    return this.next() < 0.5 ? -1 : 1;
  }
}

/** Critically-damped-ish spring used for procedural animation impulses. */
export class Spring {
  value = 0;
  vel = 0;
  constructor(
    public stiffness = 180,
    public damping = 14,
  ) {}
  /** Semi-implicit Euler with fixed substeps: stable for any frame time. */
  update(dt: number, target = 0): number {
    let left = Math.min(dt, 0.25);
    while (left > 1e-6) {
      const h = Math.min(left, 1 / 120);
      const a = -this.stiffness * (this.value - target) - this.damping * this.vel;
      this.vel += a * h;
      this.value += this.vel * h;
      left -= h;
    }
    if (!Number.isFinite(this.value) || !Number.isFinite(this.vel)) this.reset();
    return this.value;
  }
  kick(v: number): void {
    this.vel += v;
  }
  reset(): void {
    this.value = 0;
    this.vel = 0;
  }
}

/** Distance from point to segment squared helper for 2D (x,z) collision. */
export function segmentCircleHit(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  r: number,
): number {
  // Returns t in [0,1] of first contact or -1.
  const dx = bx - ax;
  const dz = bz - az;
  const fx = ax - cx;
  const fz = az - cz;
  const a = dx * dx + dz * dz;
  const c = fx * fx + fz * fz - r * r;
  if (c <= 0) return 0;
  if (a < 1e-9) return -1;
  const b = 2 * (fx * dx + fz * dz);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}

/** Distance from point (px, pz) to segment a–b (2D). */
export function pointSegDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l = dx * dx + dz * dz;
  const t = l < 1e-9 ? 0 : clamp(((px - ax) * dx + (pz - az) * dz) / l, 0, 1);
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/** Closest distance between segments p1–p2 and q1–q2 (2D); 0 when they cross. */
export function segSegDist(p1x: number, p1z: number, p2x: number, p2z: number, q1x: number, q1z: number, q2x: number, q2z: number): number {
  const d1 = (q2x - q1x) * (p1z - q1z) - (q2z - q1z) * (p1x - q1x);
  const d2 = (q2x - q1x) * (p2z - q1z) - (q2z - q1z) * (p2x - q1x);
  const d3 = (p2x - p1x) * (q1z - p1z) - (p2z - p1z) * (q1x - p1x);
  const d4 = (p2x - p1x) * (q2z - p1z) - (p2z - p1z) * (q2x - p1x);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(
    pointSegDist(p1x, p1z, q1x, q1z, q2x, q2z),
    pointSegDist(p2x, p2z, q1x, q1z, q2x, q2z),
    pointSegDist(q1x, q1z, p1x, p1z, p2x, p2z),
    pointSegDist(q2x, q2z, p1x, p1z, p2x, p2z),
  );
}

export interface ClampResult {
  x: number;
  z: number;
  hit: boolean;
  nx: number;
  nz: number;
}

/** Clamp a point into a rounded rectangle centred at origin. */
export function clampRoundedRect(x: number, z: number, hx: number, hz: number, r: number, out: ClampResult): ClampResult {
  const ix = hx - r;
  const iz = hz - r;
  const qx = clamp(x, -ix, ix);
  const qz = clamp(z, -iz, iz);
  const dx = x - qx;
  const dz = z - qz;
  const d = Math.hypot(dx, dz);
  if (d > r) {
    out.x = qx + (dx / d) * r;
    out.z = qz + (dz / d) * r;
    out.hit = true;
    out.nx = dx / d;
    out.nz = dz / d;
  } else {
    out.x = x;
    out.z = z;
    out.hit = false;
    out.nx = 0;
    out.nz = 0;
  }
  return out;
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace('.0', '') + 'M';
  if (n >= 10_000) return Math.round(n / 1000) + 'K';
  if (n >= 1000) return (n / 1000).toFixed(1).replace('.0', '') + 'K';
  return String(Math.round(n));
}

export function formatMoney(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}
