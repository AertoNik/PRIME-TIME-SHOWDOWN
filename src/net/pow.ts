import { K } from './sha256';

// Alpha 1.8.4 — the registration challenge (proof of work, see backend/pb_hooks/lib/guard.js): find a
// number n so that SHA-256(salt + ':' + n) starts with `bits` zero bits. The page solves it while the
// player fills in the form — about a second on a phone, invisible on a computer. No third party, no
// cookie, nothing about the player leaves the page.
//
// The message (32 hex characters + ':' + up to 12 digits) always fits one SHA-256 block, so this is a
// single-block SHA-256 without allocations, many times faster than the general sha256(); the server
// checks the answer with Go's own SHA-256.

const IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const W = new Int32Array(64);

/** The first 32 bits of SHA-256(prefix + nonce) — prefix and nonce ASCII, together at most 55 bytes. */
export function powWord(prefix: string, nonce: string): number {
  const msg = prefix + nonce;
  const len = msg.length;
  W.fill(0, 0, 16);
  for (let i = 0; i < len; i++) W[i >> 2] |= (msg.charCodeAt(i) & 0xff) << (24 - (i & 3) * 8);
  W[len >> 2] |= 0x80 << (24 - (len & 3) * 8);
  W[15] = len * 8;
  for (let i = 16; i < 64; i++) {
    const a = W[i - 15];
    const b = W[i - 2];
    const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
    const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
    W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
  }
  let a = IV[0] | 0,
    b = IV[1] | 0,
    c = IV[2] | 0,
    d = IV[3] | 0,
    e = IV[4] | 0,
    f = IV[5] | 0,
    g = IV[6] | 0,
    h = IV[7] | 0;
  for (let i = 0; i < 64; i++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
    h = g;
    g = f;
    f = e;
    e = (d + t1) | 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) | 0;
  }
  return (IV[0] + a) >>> 0;
}

/** Leading zero bits of a 32-bit word (32 for zero). */
export const zeroBits = (w: number): number => Math.clz32(w);

/**
 * Solve a challenge: yields to the page every few thousand tries (the game keeps animating and the
 * form stays responsive). Rejects when `signal` is aborted.
 */
export async function solvePow(salt: string, bits: number, signal?: AbortSignal): Promise<string> {
  const prefix = salt + ':';
  let n = 0;
  for (;;) {
    const end = n + 4000;
    for (; n < end; n++) if (Math.clz32(powWord(prefix, String(n))) >= bits) return String(n);
    if (signal?.aborted) throw new Error('aborted');
    await new Promise((r) => setTimeout(r, 0));
  }
}
