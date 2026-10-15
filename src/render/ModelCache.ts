import { FIGHTERS, RIVALS, rivalFighterDef } from '../config/fighters';
import type { FighterDef } from '../config/types';
import { FighterAnimator } from './FighterAnimator';
import { createFighterRig, type FighterRig } from './FighterModel';

export interface CachedFighter {
  rig: FighterRig;
  anim: FighterAnimator;
}

/** Archetype definition for a look id (player fighters and rivals). */
export function defForLook(look: string): FighterDef {
  if (look in FIGHTERS) return FIGHTERS[look as keyof typeof FIGHTERS];
  const rival = Object.values(RIVALS).find((r) => r.look === look);
  return rival ? rivalFighterDef(rival) : FIGHTERS.ray;
}

/** One rig instance per look (plus hologram twins), built lazily and reused. */
export class ModelCache {
  private map = new Map<string, CachedFighter>();
  private holo = new Map<string, CachedFighter>();

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

  getHolo(look: string): CachedFighter {
    let c = this.holo.get(look);
    if (!c) {
      const def = defForLook(look);
      const rig = createFighterRig(look, true);
      c = { rig, anim: new FighterAnimator(rig, def.idleStyle, def.dashStyle, def.victoryStyle) };
      this.holo.set(look, c);
    }
    return c;
  }

  /** Pre-build all rigs (avoids hitches when a match starts). */
  warm(looks: string[]): void {
    for (const l of looks) this.get(l);
  }
}
