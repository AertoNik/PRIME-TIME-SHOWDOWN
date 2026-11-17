import { crypto } from './node';
import { getRigGeometry } from '../../src/render/FighterModel';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BufferGeometry } from 'three';

// Alpha 1.8.8 — a fingerprint of a look's procedural geometry (every bone's toon and glow parts, the
// face parts, the muzzle and hand points). `scripts/lib/look-baseline.json` holds the prints of every
// look taken BEFORE the PRIME SHOP skins were added: `npm run shop` compares them, so the standard
// fighters provably keep exactly their old models.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function geoPrint(h: any, g: BufferGeometry | null): void {
  if (!g) {
    h.update('∅');
    return;
  }
  for (const name of Object.keys(g.attributes).sort()) {
    // (Beta 2.3: `ptMat` / `ptThin` are shading data — the material class and the outline's thinness of a part — not the
    // shape: the print stays a fingerprint of the model's form; npm run char23 checks those two on their own)
    if (name === 'ptMat' || name === 'ptThin') continue;
    const a = g.attributes[name].array as ArrayLike<number>;
    h.update(name + ':' + a.length + ':');
    // rounded, so a different float order cannot change the print while any real change does
    let s = '';
    for (let i = 0; i < a.length; i++) s += Math.round(a[i] * 1e4) + ',';
    h.update(s);
  }
  const idx = g.index;
  h.update('i' + (idx ? idx.count : 0));
}

/**
 * Beta 2.1: the shoes moved from the shin onto their own ankle bone (`footL` / `footR`, origin = the shin's end, d.shin
 * below the knee) so a foot can stay flat on the floor — the same shapes. The print measures the model, not the bone
 * split: the foot's geometry is put back where it was, appended to the shin's in the shin's frame, exactly as the shin
 * built it before — so every look must still match its pre-1.8.8 print value for value (no tolerance).
 */
function shinWithFoot(shin: BufferGeometry | null, foot: BufferGeometry | null, shinLen: number): BufferGeometry | null {
  if (!foot) return shin;
  // (Beta 2.2: the boot's morph targets — its bend at the ankle — are not part of the shape: left out of the print)
  const bare = (g: BufferGeometry) => {
    const c = g.clone();
    c.morphAttributes = {};
    c.morphTargetsRelative = false;
    return c;
  };
  const f = bare(foot);
  f.translate(0, -shinLen, 0);
  const merged = shin ? mergeGeometries([bare(shin), f], false) : f;
  if (!merged) throw new Error('rigPrint: the shin and the foot could not be merged');
  return merged;
}

export function rigPrint(lookId: string): string {
  const G = getRigGeometry(lookId);
  const h = crypto.createHash('sha256');
  for (const bone of Object.keys(G.bones).sort()) {
    const b = G.bones[bone as keyof typeof G.bones];
    // (1.9.7: the optional bones of CRAX — the key and the crank — are empty for everyone else; an empty one is left out,
    // so every look without them keeps exactly its earlier print)
    if ((bone === 'key' || bone === 'crank') && !b.toon && !b.glow) continue;
    // (Beta 2.1: the foot is printed inside its shin — see shinWithFoot)
    if (bone === 'footL' || bone === 'footR') continue;
    h.update(bone);
    if (bone === 'shinL' || bone === 'shinR') {
      const foot = G.bones[bone === 'shinL' ? 'footL' : 'footR'];
      geoPrint(h, shinWithFoot(b.toon, foot.toon, G.dims.shin));
      geoPrint(h, shinWithFoot(b.glow, foot.glow, G.dims.shin));
      continue;
    }
    geoPrint(h, b.toon);
    geoPrint(h, b.glow);
  }
  for (const part of [G.eyes, G.koEyes, G.brows, G.mouth, G.mouthOpen]) geoPrint(h, part);
  h.update(JSON.stringify([G.eyePivot, G.mouthPivot, G.headCenterY, G.muzzleR, G.muzzleL, G.weaponHand]));
  return h.digest('hex').slice(0, 24);
}
