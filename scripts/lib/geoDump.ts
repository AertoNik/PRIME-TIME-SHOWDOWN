// Beta 2.3 — `npx tsx scripts/lib/geoDump.ts [--v22]`: every look's rig geometry as JSON on stdout for npm run geo23 —
// per bone (toon and glow): a SHA-256 of all attributes and the index, the vertex count, the bounding box; for the head
// and the limbs also the positions and the colours (to compare the Beta 2.2 build with today's in two processes — the
// geometry cache holds one build per process); the model prints, triangles and draw calls per look.
import type { BufferGeometry } from 'three';
import { crypto, proc } from './node';

const FM = await import('../../src/render/FighterModel');
FM.RIG_BUILD.v22 = proc.argv.includes('--v22');
const { LOOKS } = await import('../../src/config/looks');
const { rigPrint } = await import('./rigPrint');
const { statsOf } = await import('../char-stats');
const KEEP = new Set(['head', 'thighL', 'thighR', 'shinL', 'shinR', 'upperArmL', 'upperArmR', 'foreArmL', 'foreArmR']);

function info(g: BufferGeometry, keep: boolean) {
  const h = crypto.createHash('sha256');
  for (const n of Object.keys(g.attributes).sort()) h.update(n + ':' + Array.from(g.attributes[n].array as ArrayLike<number>).join(','));
  h.update('i' + (g.index ? Array.from(g.index.array as ArrayLike<number>).join(',') : ''));
  g.computeBoundingBox();
  const b = g.boundingBox!;
  return {
    hash: h.digest('hex'),
    n: g.getAttribute('position').count,
    box: [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z],
    pos: keep ? Array.from(g.getAttribute('position').array as ArrayLike<number>) : undefined,
    col: keep ? Array.from(g.getAttribute('color').array as ArrayLike<number>) : undefined,
  };
}

const out: Record<string, unknown> = {};
for (const id of Object.keys(LOOKS)) {
  const G = FM.getRigGeometry(id);
  const bones: Record<string, unknown> = {};
  for (const [b, bg] of Object.entries(G.bones)) {
    if (bg.toon) bones[b + '.toon'] = info(bg.toon, KEEP.has(b));
    if (bg.glow) bones[b + '.glow'] = info(bg.glow, false);
  }
  for (const k of ['eyes', 'koEyes', 'brows', 'mouth', 'mouthOpen'] as const) bones[k] = info(G[k], false);
  const st = statsOf(id);
  out[id] = { bones, print: rigPrint(id), dims: G.dims, stubble: G.look.accessories.includes('stubble'), boots: !!G.look.shoes.boots, tris: st.triangles, drawCalls: st.drawCalls, verts: st.vertices };
}
proc.stdout.write(JSON.stringify(out));
