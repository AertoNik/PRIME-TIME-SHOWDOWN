// Beta 2.2 — `npx tsx scripts/lib/rigDump.ts [--legacy21 | --v22]`: every look's rig geometry as JSON on stdout (the position of
// each shin vertex, a SHA-256 of every other bone's attributes, the model prints) — for npm run boots22, which compares
// the Beta 2.1 build with today's in two processes (the geometry cache holds one build per process).
import { crypto, proc } from './node';

const FM = await import('../../src/render/FighterModel');
FM.RIG_BUILD.legacy21 = proc.argv.includes('--legacy21');
// Beta 2.3: `--v22` — the Beta 2.2 shapes (before the 2.3 head and limb work)
FM.RIG_BUILD.v22 = proc.argv.includes('--v22');
const { LOOKS } = await import('../../src/config/looks');
const { rigPrint } = await import('./rigPrint');
const out: Record<string, unknown> = {};
for (const id of Object.keys(LOOKS)) {
  const G = FM.getRigGeometry(id);
  const bones: Record<string, string> = {};
  const shins: Record<string, number[]> = {};
  for (const [b, bg] of Object.entries(G.bones)) {
    const g = bg.toon;
    if (!g) continue;
    if (b === 'shinL' || b === 'shinR') shins[b] = Array.from(g.getAttribute('position').array as ArrayLike<number>);
    const h = crypto.createHash('sha256');
    for (const n of Object.keys(g.attributes).sort()) if (!((b === 'shinL' || b === 'shinR') && n === 'position')) h.update(n + ':' + Array.from(g.attributes[n].array as ArrayLike<number>).join(','));
    h.update('i' + (g.index ? Array.from(g.index.array as ArrayLike<number>).join(',') : ''));
    bones[b] = h.digest('hex');
  }
  const foot = G.bones.footL.toon;
  out[id] = { bones, shins, shin: G.dims.shin, boots: !!G.look.shoes.boots, morphs: Object.keys(foot?.morphAttributes ?? {}), print: rigPrint(id) };
}
proc.stdout.write(JSON.stringify(out));
