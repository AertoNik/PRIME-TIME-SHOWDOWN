import { BOSSES } from '../config/boss.config';
import { CHALLENGES, SURVIVAL } from '../config/modes.config';
import { COSMETICS, COSMETIC_ORDER, type CosmeticDef, type CosmeticId, type CosmeticSlot } from '../config/cosmetics.config';
import { careerStages } from './careerStages';
import type { SaveData } from './SaveSystem';

/** The save interface the collection needs (SaveSystem, or an in-memory test double). */
export interface CollectionStore {
  data: SaveData;
  save(): void;
}

export type CollectionTab = 'all' | 'cosmetics' | 'achievements' | 'seasons';

/** One cosmetic as the collection shows it. */
export interface CosmeticView {
  def: CosmeticDef;
  owned: boolean;
  equipped: boolean;
  /** Not looked at in MY COLLECTION yet. */
  fresh: boolean;
  /** When / from what it was obtained (from the collection history). */
  at: number;
}

/** A permanent achievement read from the player's real records (never stored twice). */
export interface AchievementView {
  id: string;
  title: string;
  desc: string;
  /** "Boss Fight", "Survival", "Prime Challenge", "Карьера". */
  source: string;
  done: boolean;
  /** When it was achieved, if the save knows (0 = unknown / not yet). */
  at: number;
  /** Extra line ("Побед: 3", "Лучшее время 74 с"). */
  note: string;
  /** Cosmetic that came with it, if any. */
  reward: CosmeticId | null;
  art: 'belt' | 'star' | 'studio' | 'survival' | 'challenge' | 'career';
}

/**
 * MY COLLECTION (Alpha 1.5): the one place that owns cosmetics. All state lives in
 * save.cosmetics — owned, equipped per slot, history and "seen" marks — so the
 * seasonal event, BOSS FIGHT and the career all grant through here, an item can be
 * owned only once, and nothing disappears when an event ends.
 */
export class Collection {
  private store: CollectionStore;
  private clock: () => number;

  constructor(store: CollectionStore, clock: () => number = () => Date.now()) {
    this.store = store;
    this.clock = clock;
  }

  private get c() {
    return this.store.data.cosmetics;
  }

  owns(id: CosmeticId): boolean {
    return this.c.owned.includes(id);
  }

  /**
   * Adds an item once (a second grant changes nothing and returns false). A newly
   * obtained item is equipped right away, as rewards always were. The caller saves.
   */
  grant(id: CosmeticId, source: string): boolean {
    const c = this.c;
    if (c.owned.includes(id)) return false;
    c.owned.push(id);
    c.history.push({ id, event: source.slice(0, 64), at: this.clock() });
    c.equipped[COSMETICS[id].slot] = id;
    return true;
  }

  equipped(slot: CosmeticSlot): CosmeticId | null {
    return this.c.equipped[slot] ?? null;
  }

  isEquipped(id: CosmeticId): boolean {
    return this.equipped(COSMETICS[id].slot) === id;
  }

  /** Equip an owned item (replacing whatever was in its slot), or take it off with `on = false`. Saves. */
  setEquipped(id: CosmeticId, on: boolean): boolean {
    if (!this.owns(id)) return false;
    const slot = COSMETICS[id].slot;
    const eq = this.c.equipped;
    if (on) eq[slot] = id;
    else if (eq[slot] === id) delete eq[slot];
    this.store.save();
    return true;
  }

  acquiredAt(id: CosmeticId): number {
    return this.c.history.find((h) => h.id === id)?.at ?? 0;
  }

  /** Owned items not yet looked at in the collection. */
  freshCount(): number {
    return this.c.owned.filter((id) => !this.c.seen.includes(id)).length;
  }

  markAllSeen(): void {
    const c = this.c;
    if (c.owned.every((id) => c.seen.includes(id))) return;
    c.seen = c.owned.slice();
    this.store.save();
  }

  view(id: CosmeticId): CosmeticView {
    const owned = this.owns(id);
    return { def: COSMETICS[id], owned, equipped: owned && this.isEquipped(id), fresh: owned && !this.c.seen.includes(id), at: this.acquiredAt(id) };
  }

  cosmetics(filter?: (d: CosmeticDef) => boolean): CosmeticView[] {
    return COSMETIC_ORDER.filter((id) => !filter || filter(COSMETICS[id])).map((id) => this.view(id));
  }

  // ------------------------------------------------------------ achievements
  /** Permanent achievements, all derived from records the save already keeps. */
  achievements(): AchievementView[] {
    const s = this.store.data;
    const out: AchievementView[] = [];
    // BOSS FIGHT: the first win over the legendary champion (not tied to any season)
    for (const def of Object.values(BOSSES)) {
      const p = s.modes.boss[def.id];
      out.push({
        id: `boss-${def.id}`,
        title: 'Победитель легенды',
        desc: `Победа над Виктором «Легендой» Вейлом в ${def.title}.`,
        source: 'Boss Fight',
        done: !!p && p.firstWinAt > 0,
        at: p?.firstWinAt ?? 0,
        note: p?.wins ? `Побед: ${p.wins}${p.bestTime ? ` · лучшее время ${p.bestTime} с` : ''}` : p?.attempts ? `Лучший результат: фаза ${p.bestPhase}/3` : 'Нужно 5 побед бойцом в Classic Duel',
        reward: def.rewards.firstWin.cosmetic,
        art: 'belt',
      });
    }
    // SURVIVAL: the whole marathon
    const sv = s.modes.survival;
    out.push({
      id: 'survival-clear',
      title: 'Последняя звезда эфира',
      desc: `Пройдите все ${SURVIVAL.waves.length} волн Survival одним бойцом.`,
      source: 'Survival',
      done: sv.completions > 0,
      at: 0,
      note: sv.completions > 0 ? `Пройдено: ${sv.completions}` : `Рекорд: волна ${sv.bestWave}/${SURVIVAL.waves.length}`,
      reward: null,
      art: 'survival',
    });
    // PRIME CHALLENGE: each special broadcast
    for (const ch of CHALLENGES) {
      const p = s.modes.challenges[ch.id];
      out.push({
        id: `challenge-${ch.id}`,
        title: ch.title,
        desc: ch.goalShort,
        source: 'Prime Challenge',
        done: !!p && p.firstClearAt > 0,
        at: p?.firstClearAt ?? 0,
        note: p?.clears ? `Пройдено: ${p.clears}` : p?.attempts ? `Попыток: ${p.attempts}` : 'Ещё не пройдено',
        reward: null,
        art: 'challenge',
      });
    }
    // CAREER: producer stages beyond the first
    for (const st of careerStages(s).slice(1)) {
      out.push({
        id: `career-${st.def.id}`,
        title: st.def.title,
        desc: st.def.desc,
        source: 'Карьера продюсера',
        done: st.reached,
        at: 0,
        note: st.reached ? (st.claimed ? 'Награда получена' : 'Награда ждёт в разделе «Карьера»') : `${st.milestones.filter((m) => m.done).length}/${st.milestones.length} условий`,
        reward: st.def.reward?.cosmetic ?? null,
        art: st.def.id === 'legendary' ? 'studio' : 'career',
      });
    }
    return out;
  }
}
