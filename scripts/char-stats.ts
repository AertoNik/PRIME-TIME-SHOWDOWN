// Beta 2.3 — CHARACTER STATS (npx tsx scripts/char-stats.ts [--json=path]): what a fighter costs to draw, per look —
// triangles and vertices of its rig (body, glow and face parts), the meshes it puts in the scene (draw calls: every
// body part is drawn twice — the toon pass and the outline shell), the materials, and how many geometries the look
// keeps. The Beta 2.3 report compares these with the numbers measured on the published Beta 2.2.
import type { BufferGeometry, Mesh, Object3D } from 'three';
import { fs, proc } from './lib/node';

let seed = 0x2b21;
Math.random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

const { LOOKS } = await import('../src/config/looks');
const { createFighterRig } = await import('../src/render/FighterModel');

export interface LookStats {
  triangles: number;
  vertices: number;
  drawCalls: number;
  geometries: number;
  materials: number;
  morphTargets: number;
}

const tris = (g: BufferGeometry) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;

export function statsOf(lookId: string): LookStats {
  const rig = createFighterRig(lookId, false);
  const geos = new Set<BufferGeometry>();
  const mats = new Set<unknown>();
  let triangles = 0;
  let vertices = 0;
  let drawCalls = 0;
  let morphTargets = 0;
  rig.root.traverse((o: Object3D) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    drawCalls++;
    mats.add(m.material);
    triangles += tris(m.geometry);
    if (!geos.has(m.geometry)) {
      geos.add(m.geometry);
      vertices += m.geometry.getAttribute('position').count;
      morphTargets += m.geometry.morphAttributes.position?.length ?? 0;
    }
  });
  return { triangles: Math.round(triangles), vertices, drawCalls, geometries: geos.size, materials: mats.size, morphTargets };
}

if (proc.argv[1]?.endsWith('char-stats.ts')) {
  const out: Record<string, LookStats> = {};
  for (const id of Object.keys(LOOKS)) out[id] = statsOf(id);
  const ids = Object.keys(out);
  const sum = (k: keyof LookStats) => ids.reduce((n, id) => n + out[id][k], 0);
  for (const id of ids) {
    const s = out[id];
    console.log(`${id.padEnd(20)} tris ${String(s.triangles).padStart(6)}  verts ${String(s.vertices).padStart(6)}  draw calls ${String(s.drawCalls).padStart(3)}  geometries ${String(s.geometries).padStart(3)}  materials ${s.materials}  morphs ${s.morphTargets}`);
  }
  const mean = { triangles: Math.round(sum('triangles') / ids.length), vertices: Math.round(sum('vertices') / ids.length), drawCalls: +(sum('drawCalls') / ids.length).toFixed(1), geometries: +(sum('geometries') / ids.length).toFixed(1) };
  console.log(`\nlooks ${ids.length} · mean`, JSON.stringify(mean), '· max tris', Math.max(...ids.map((id) => out[id].triangles)));
  const jsonOut = (proc.argv.find((a: string) => a.startsWith('--json=')) ?? '').slice(7);
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ looks: out, mean }, null, 1));
}
