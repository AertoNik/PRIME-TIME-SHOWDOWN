import { FIGHTERS, RIVALS, rivalFighterDef } from '../config/fighters';
import { LOOKS } from '../config/looks';
import type { FighterDef } from '../config/types';
import { FighterAnimator } from './FighterAnimator';
import { createFighterRig, type FighterRig } from './FighterModel';

export interface CachedFighter {
  rig: FighterRig;
  anim: FighterAnimator;
}

/**
 * Archetype definition for a look id (player fighters and rivals). Alpha 1.8.8: a PRIME SHOP skin
 * (looks.ts `base`) animates exactly like its own fighter.
 */
export function defForLook(look: string): FighterDef {
  look = LOOKS[look]?.base ?? look;
  if (look in FIGHTERS) return FIGHTERS[look as keyof typeof FIGHTERS];
  const rival = Object.values(RIVALS).find((r) => r.look === look);
  return rival ? rivalFighterDef(rival) : FIGHTERS.ray;
}

/**
 * Alpha 1.9.4: which copy of a look's rig. One Object3D can stand in one place only, so two fighters in the SAME look
 * (a PRIME LEAGUE mirror match: RAY against another producer's RAY) need two copies — sharing one made a fighter vanish
 * (both sides moved the same model; the last one written was drawn) and turned the other the wrong way. 0 = the usual
 * copy (menu, side 0, every career rival), 1 = the second fighter in the same look, 'studio' = the portrait studio's
 * own copy when the usual one is on stage.
 */
export type RigCopy = 0 | 1 | 'studio';
const keyOf = (look: string, copy: RigCopy) => (copy === 0 ? look : `${look}@${copy}`);

/** One rig instance per look (plus hologram twins), built lazily and reused. */
export class ModelCache {
  private map = new Map<string, CachedFighter>();
  private holo = new Map<string, CachedFighter>();
  private ghost = new Map<string, CachedFighter>();

  get(look: string, copy: RigCopy = 0): CachedFighter {
    const key = keyOf(look, copy);
    let c = this.map.get(key);
    if (!c) {
      const def = defForLook(look);
      const rig = createFighterRig(look, false);
      c = { rig, anim: new FighterAnimator(rig, def.idleStyle, def.dashStyle, def.victoryStyle) };
      this.map.set(key, c);
    }
    return c;
  }

  /** Hologram twin `n` of a look (0: decoys of PHANTOM STEP / DOUBLE TAKE, 1: Alpha 1.6 HOLO DECOY). */
  getHolo(look: string, n = 0, copy: RigCopy = 0): CachedFighter {
    const key = keyOf(n ? `${look}#${n}` : look, copy);
    let c = this.holo.get(key);
    if (!c) {
      const def = defForLook(look);
      const rig = createFighterRig(look, true);
      c = { rig, anim: new FighterAnimator(rig, def.idleStyle, def.dashStyle, def.victoryStyle) };
      this.holo.set(key, c);
    }
    return c;
  }

  /**
   * Alpha 1.5: a second hologram twin used for short visual afterimages (FALSE START), so it
   * never fights the PHANTOM STEP decoy for the same rig. Built once per look and reused.
   */
  getGhost(look: string, copy: RigCopy = 0): CachedFighter {
    const key = keyOf(look, copy);
    let c = this.ghost.get(key);
    if (!c) {
      const def = defForLook(look);
      const rig = createFighterRig(look, true);
      c = { rig, anim: new FighterAnimator(rig, def.idleStyle, def.dashStyle, def.victoryStyle) };
      this.ghost.set(key, c);
    }
    return c;
  }

  /** Pre-build all rigs (avoids hitches when a match starts). */
  warm(looks: string[]): void {
    for (const l of looks) this.get(l);
  }
}
