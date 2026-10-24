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

/** One rig instance per look (plus hologram twins), built lazily and reused. */
export class ModelCache {
  private map = new Map<string, CachedFighter>();
  private holo = new Map<string, CachedFighter>();
  private ghost = new Map<string, CachedFighter>();

  get(look: string): CachedFighter {
    let c = this.map.get(look);
    if (!c) {
      const def = defForLook(look);
      const rig = createFighterRig(look, false);
      c = { rig, anim: new FighterAnimator(rig, def.idleStyle, def.dashStyle, def.victoryStyle) };
      this.map.set(look, c);
    }
    return c;
  }

  /** Hologram twin `n` of a look (0: decoys of PHANTOM STEP / DOUBLE TAKE, 1: Alpha 1.6 HOLO DECOY). */
  getHolo(look: string, n = 0): CachedFighter {
    const key = n ? `${look}#${n}` : look;
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
  getGhost(look: string): CachedFighter {
    let c = this.ghost.get(look);
    if (!c) {
      const def = defForLook(look);
      const rig = createFighterRig(look, true);
      c = { rig, anim: new FighterAnimator(rig, def.idleStyle, def.dashStyle, def.victoryStyle) };
      this.ghost.set(look, c);
    }
    return c;
  }

  /** Pre-build all rigs (avoids hitches when a match starts). */
  warm(looks: string[]): void {
    for (const l of looks) this.get(l);
  }
}
