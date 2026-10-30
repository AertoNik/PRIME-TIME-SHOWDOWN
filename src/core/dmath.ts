/**
 * Alpha 1.9.0 PRIME LEAGUE: deterministic math for the battle simulation.
 *
 * JavaScript engines may round Math.sin / cos / atan2 / exp / hypot differently in the last
 * bit (V8 in the browser, goja in PocketBase on the server). A fight is chaotic: one bit of
 * difference becomes a different hit a few seconds later, so the server could not replay a
 * PRIME LEAGUE fight and reach the same result. These versions use only + − × ÷, sqrt,
 * floor and comparisons — IEEE 754 makes every one of them exact or correctly rounded, so
 * every engine computes the very same bits. Algorithms and coefficients: fdlibm (Sun
 * Microsystems, freely redistributable), accurate to about 1 ulp for the game's ranges.
 *
 * Use them in everything that changes the fight state (src/combat, src/core/math helpers
 * the fight calls). Rendering may keep Math.*.
 */

// ------------------------------------------------------------------ sin / cos
const PIO2_1 = 1.57079632673412561417e+0; // first 33 bits of π/2 (n · PIO2_1 is exact for |n| < 2^20)
const PIO2_1T = 6.07710050650619224932e-11; // π/2 − PIO2_1
const INV_PIO2 = 6.36619772367581382433e-1;

const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;

const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.08757232129817482790e-9;
const C6 = -1.13596475577881948265e-11;

/** sin on [−π/4, π/4]. */
function kSin(x: number): number {
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return x + v * (S1 + z * r);
}

/** cos on [−π/4, π/4]. */
function kCos(x: number): number {
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  return 1 - (0.5 * z - z * r);
}

/** x = n·π/2 + r, |r| ≤ π/4; returns n mod 4 and r in `red`. */
const red = { n: 0, r: 0 };
function reduce(x: number): void {
  const n = Math.floor(x * INV_PIO2 + 0.5);
  red.r = x - n * PIO2_1 - n * PIO2_1T;
  red.n = ((n % 4) + 4) % 4;
}

function sin(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  if (x > -0.7853981633974483 && x < 0.7853981633974483) return kSin(x);
  reduce(x);
  const r = red.r;
  switch (red.n) {
    case 0:
      return kSin(r);
    case 1:
      return kCos(r);
    case 2:
      return -kSin(r);
    default:
      return -kCos(r);
  }
}

function cos(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  if (x > -0.7853981633974483 && x < 0.7853981633974483) return kCos(x);
  reduce(x);
  const r = red.r;
  switch (red.n) {
    case 0:
      return kCos(r);
    case 1:
      return -kSin(r);
    case 2:
      return -kCos(r);
    default:
      return kSin(r);
  }
}

// ----------------------------------------------------------------- atan / atan2
const ATANHI = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.57079632679489655800e+0];
const ATANLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [
  3.33333333333329318027e-1, -1.99999999998764832476e-1, 1.42857142725034663711e-1, -1.11111104054623557880e-1,
  9.09088713343650656196e-2, -7.69187620504482999495e-2, 6.66107313738753120669e-2, -5.83357013379057348645e-2,
  4.97687799461593236017e-2, -3.65315727442169155270e-2, 1.62858201153657823623e-2,
];
const PI = 3.1415926535897931160e+0;
const PI_LO = 1.2246467991473531772e-16;
const PI_O2 = 1.5707963267948965580e+0;

function atan(x: number): number {
  if (x !== x) return NaN;
  const neg = x < 0;
  let a = neg ? -x : x;
  if (a >= 7.378697629483821e+19) return neg ? -(ATANHI[3] + ATANLO[3]) : ATANHI[3] + ATANLO[3]; // 2^66
  let id: number;
  if (a < 0.4375) {
    if (a < 1.862645149230957e-9) return x; // 2^-29
    id = -1;
    a = x;
  } else if (a < 1.1875) {
    if (a < 0.6875) {
      id = 0;
      a = (2 * a - 1) / (2 + a);
    } else {
      id = 1;
      a = (a - 1) / (a + 1);
    }
  } else if (a < 2.4375) {
    id = 2;
    a = (a - 1.5) / (1 + 1.5 * a);
  } else {
    id = 3;
    a = -1 / a;
  }
  const z = a * a;
  const w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) return a - a * (s1 + s2);
  const r = ATANHI[id] - (a * (s1 + s2) - ATANLO[id] - a);
  return neg ? -r : r;
}

const negZero = (v: number): boolean => v === 0 && 1 / v < 0;

function atan2(y: number, x: number): number {
  if (x !== x || y !== y) return NaN;
  if (x === 1) return atan(y);
  if (y === 0) {
    if (x > 0 || (x === 0 && !negZero(x))) return y; // ±0
    return negZero(y) ? -PI : PI;
  }
  if (x === 0) return y > 0 ? PI_O2 : -PI_O2;
  if (!Number.isFinite(x)) {
    if (x > 0) {
      if (!Number.isFinite(y)) return y > 0 ? PI / 4 : -PI / 4;
      return y > 0 ? 0 : -0;
    }
    if (!Number.isFinite(y)) return y > 0 ? (3 * PI) / 4 : (-3 * PI) / 4;
    return y > 0 ? PI : -PI;
  }
  if (!Number.isFinite(y)) return y > 0 ? PI_O2 : -PI_O2;
  const q = y / x;
  const aq = q < 0 ? -q : q;
  let z: number;
  if (aq > 1.152921504606847e+18) z = PI_O2 + 0.5 * PI_LO; // 2^60
  else if (x < 0 && aq < 8.673617379884035e-19) z = 0; // 2^-60
  else z = atan(aq);
  if (x > 0) return y > 0 ? z : -z;
  return y > 0 ? PI - (z - PI_LO) : z - PI_LO - PI;
}

// ------------------------------------------------------------------------- exp
const LN2_HI = 6.93147180369123816490e-1;
const LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = 1.44269504088896338700e+0;
const P1 = 1.66666666666666019037e-1;
const P2 = -2.77777777770155933842e-3;
const P3 = 6.61375632143793436117e-5;
const P4 = -1.65339022054652515390e-6;
const P5 = 4.13813679705723846039e-8;

/** 2^k exactly (powers of two are exact, so a product of 2s or ½s is too). */
function pow2(k: number): number {
  let r = 1;
  if (k > 0) for (let i = 0; i < k; i++) r *= 2;
  else for (let i = 0; i > k; i--) r *= 0.5;
  return r;
}

function exp(x: number): number {
  if (x !== x) return NaN;
  if (x > 709.782712893384) return Infinity;
  if (x < -745.1332191019411) return 0;
  const ax = x < 0 ? -x : x;
  let k = 0;
  let hi = 0;
  let lo = 0;
  if (ax > 0.34657359027997264) {
    // |x| > ½ ln 2
    k = x < 0 ? Math.ceil(INV_LN2 * x - 0.5) : Math.floor(INV_LN2 * x + 0.5);
    hi = x - k * LN2_HI;
    lo = k * LN2_LO;
    x = hi - lo;
  } else if (ax < 3.725290298461914e-9) {
    return 1 + x; // 2^-28
  }
  const t = x * x;
  const c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return 1 - ((x * c) / (c - 2) - x);
  const y = 1 - (lo - (x * c) / (2 - c) - hi);
  // keep the intermediate finite near the limits: split a large scale in two exact steps
  if (k > 1000) return y * pow2(k - 1000) * pow2(1000);
  if (k < -1000) return y * pow2(k + 1000) * pow2(-1000);
  return y * pow2(k);
}

// ----------------------------------------------------------------------- hypot
/** √(x² + y²): sqrt is correctly rounded by IEEE 754, so this is exact-same everywhere (game ranges never overflow). */
function hypot(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

export const dm = { sin, cos, atan2, atan, exp, hypot } as const;
