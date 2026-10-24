import { crypto } from './node';
import { getRigGeometry } from '../../src/render/FighterModel';
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

export function rigPrint(lookId: string): string {
  const G = getRigGeometry(lookId);
  const h = crypto.createHash('sha256');
  for (const bone of Object.keys(G.bones).sort()) {
    const b = G.bones[bone as keyof typeof G.bones];
    h.update(bone);
    geoPrint(h, b.toon);
    geoPrint(h, b.glow);
  }
  for (const part of [G.eyes, G.koEyes, G.brows, G.mouth, G.mouthOpen]) geoPrint(h, part);
  h.update(JSON.stringify([G.eyePivot, G.mouthPivot, G.headCenterY, G.muzzleR, G.muzzleL, G.weaponHand]));
  return h.digest('hex').slice(0, 24);
}
