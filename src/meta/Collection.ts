import { BOSSES } from '../config/boss.config';
import { CHALLENGES, SURVIVAL } from '../config/modes.config';
import { COSMETICS, COSMETIC_ORDER, COSMETIC_SLOTS, type CosmeticDef, type CosmeticId, type CosmeticSlot } from '../config/cosmetics.config';
import { FIGHTERS, FIGHTER_ORDER } from '../config/fighters';
import type { FighterId } from '../config/types';
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
  /** Owned by the producer (a personal item: earned by at least one fighter). */
  owned: boolean;
  /** Worn by the fighter the view was made for. */
  equipped: boolean;
  /** Not looked at in MY COLLECTION yet. */
  fresh: boolean;
  /** When / from what it was obtained (from the collection history). */
  at: number;
  /** Personal items: the fighters who earned it (empty for common items). */
  owners: FighterId[];
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
  /** Alpha 1.5.5 — a personal achievement: the fighters who earned it (null = the producer's). */
  fighters: FighterId[] | null;
}

/**
 * MY COLLECTION (Alpha 1.5): the one place that owns cosmetics. All state lives in
 * save.cosmetics — owned, equipped per slot, history and "seen" marks — so the
 * seasonal event, BOSS FIGHT and the career all grant through here, an item can be
 * owned only once, and nothing disappears when an event ends.
 *
 * Alpha 1.5.5: personal items (`CosmeticDef.personal`, e.g. «Победитель легенды») belong
 * to each fighter who earned them — `cosmetics.personal[id]` lists the fighters and each
 * fighter wears them in its own slots (`personalEquipped`), on top of the common ones.
 * Seasonal items stay out of sight until they are really obtained.
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

  /** The fighters who earned a personal item (empty for common items or not yet earned). */
  owners(id: CosmeticId): FighterId[] {
    return this.c.personal[id] ?? [];
  }

  /** Can this fighter wear the item? Common items: owned by the producer; personal: earned by that fighter. */
  ownsFor(id: CosmeticId, fighter: FighterId): boolean {
    if (!this.owns(id)) return false;
    return COSMETICS[id].personal ? this.owners(id).includes(fighter) : true;
  }

  /**
   * Adds an item once (a second grant changes nothing and returns false). A newly
   * obtained item is equipped right away, as rewards always were. A personal item is
   * granted to `fighter` (once per fighter) and worn by that fighter. The caller saves.
   */
  grant(id: CosmeticId, source: string, fighter?: FighterId): boolean {
    const c = this.c;
    const def = COSMETICS[id];
    if (def.personal) {
      if (!fighter) return false;
      const list = (c.personal[id] ??= []);
      if (list.includes(fighter)) return false;
      list.push(fighter);
      if (!c.owned.includes(id)) c.owned.push(id);
      c.history.push({ id, event: source.slice(0, 64), at: this.clock(), fighter });
      (c.personalEquipped[fighter] ??= {})[def.slot] = id;
      // a fresh personal reward is news again for the collection
      c.seen = c.seen.filter((x) => x !== id);
      return true;
    }
    if (c.owned.includes(id)) return false;
    c.owned.push(id);
    c.history.push({ id, event: source.slice(0, 64), at: this.clock() });
    c.equipped[def.slot] = id;
    return true;
  }

  /** The producer's common item in a slot. */
  equipped(slot: CosmeticSlot): CosmeticId | null {
    return this.c.equipped[slot] ?? null;
  }

  /** What a fighter actually wears in a slot: its own personal item, otherwise the common one. */
  equippedFor(slot: CosmeticSlot, fighter: FighterId): CosmeticId | null {
    const own = this.c.personalEquipped[fighter]?.[slot];
    if (own && this.ownsFor(own, fighter)) return own;
    return this.equipped(slot);
  }

  /** Every slot as the fighter wears it (for the theme, the menu nameplate and the results screen). */
  effectiveEquipped(fighter: FighterId): Partial<Record<CosmeticSlot, CosmeticId>> {
    const out: Partial<Record<CosmeticSlot, CosmeticId>> = {};
    for (const slot of COSMETIC_SLOTS) {
      const id = this.equippedFor(slot, fighter);
      if (id) out[slot] = id;
    }
    return out;
  }

  /** Common items: worn by the producer's look. Personal items: worn by that fighter. */
  isEquipped(id: CosmeticId, fighter?: FighterId): boolean {
    const def = COSMETICS[id];
    if (def.personal) return !!fighter && this.c.personalEquipped[fighter]?.[def.slot] === id;
    return this.equipped(def.slot) === id;
  }

  /**
   * Equip an item (replacing whatever was in its slot), or take it off with `on = false`. Saves.
   * Personal items need the fighter who earned them. Putting on a common item also takes the
   * fighter's own personal item off that slot, so what you tap is what you see.
   */
  setEquipped(id: CosmeticId, on: boolean, fighter?: FighterId): boolean {
    const def = COSMETICS[id];
    if (def.personal) {
      if (!fighter || !this.ownsFor(id, fighter)) return false;
      const pe = (this.c.personalEquipped[fighter] ??= {});
      if (on) pe[def.slot] = id;
      else if (pe[def.slot] === id) delete pe[def.slot];
      this.store.save();
      return true;
    }
    if (!this.owns(id)) return false;
    const eq = this.c.equipped;
    if (on) {
      eq[def.slot] = id;
      if (fighter) {
        const pe = this.c.personalEquipped[fighter];
        if (pe) delete pe[def.slot];
      }
    } else if (eq[def.slot] === id) delete eq[def.slot];
    this.store.save();
    return true;
  }

  /** Personal items from an older save that the records could not tie to a fighter. */
  unassigned(): CosmeticId[] {
    return this.c.unassigned;
  }

  /**
   * The player names, once, which fighter earned an old personal item. The choice is saved
   * and never asked again; no money or other reward is paid for it.
   */
  assignLegacy(id: CosmeticId, fighter: FighterId): boolean {
    const c = this.c;
    if (!c.unassigned.includes(id) || !FIGHTER_ORDER.includes(fighter)) return false;
    c.unassigned = c.unassigned.filter((x) => x !== id);
    const list = (c.personal[id] ??= []);
    if (!list.includes(fighter)) list.push(fighter);
    (c.personalEquipped[fighter] ??= {})[COSMETICS[id].slot] = id;
    c.history.push({ id, event: 'legacy-assign', at: this.clock(), fighter });
    this.store.save();
    return true;
  }

  acquiredAt(id: CosmeticId): number {
    return this.c.history.find((h) => h.id === id)?.at ?? 0;
  }

  /** Owned items not yet looked at in the collection. */
  freshCount(): number {
    return this.c.owned.filter((id) => !this.c.seen.includes(id)).length + this.c.unassigned.length;
  }

  markAllSeen(): void {
    const c = this.c;
    if (c.owned.every((id) => c.seen.includes(id))) return;
    c.seen = c.owned.slice();
    this.store.save();
  }

  /**
   * Alpha 1.5.5: what the collection may show. Seasonal items are a surprise: they appear
   * only once really obtained (the running event presents its own rewards in «События»);
   * an unearned item of a past or future season never shows. Everything else is visible.
   */
  visible(id: CosmeticId): boolean {
    return COSMETICS[id].source !== 'season' || this.owns(id);
  }

  view(id: CosmeticId, fighter?: FighterId): CosmeticView {
    const owned = this.owns(id);
    return {
      def: COSMETICS[id],
      owned,
      equipped: owned && this.isEquipped(id, fighter),
      fresh: owned && !this.c.seen.includes(id),
      at: this.acquiredAt(id),
      owners: this.owners(id).slice(),
    };
  }

  /** The visible items (seasonal ones only when owned), in collection order. */
  cosmetics(filter?: (d: CosmeticDef) => boolean, fighter?: FighterId): CosmeticView[] {
    return COSMETIC_ORDER.filter((id) => this.visible(id) && (!filter || filter(COSMETICS[id]))).map((id) => this.view(id, fighter));
  }

  // ------------------------------------------------------------ achievements
  /** Permanent achievements, all derived from records the save already keeps. */
  achievements(): AchievementView[] {
    const s = this.store.data;
    const out: AchievementView[] = [];
    // BOSS FIGHT: a personal achievement — each fighter who beat the legendary champion
    for (const def of Object.values(BOSSES)) {
      const p = s.modes.boss[def.id];
      const winners = FIGHTER_ORDER.filter((f) => (p?.winsByFighter[f] ?? 0) > 0);
      // an old title the player still has to tie to a fighter counts as earned too
      const legacy = this.c.unassigned.includes(def.rewards.firstWin.cosmetic);
      out.push({
        id: `boss-${def.id}`,
        title: 'Победитель легенды',
        desc: `Победа над Виктором «Легендой» Вейлом в ${def.title}. Личное достижение: каждый боец зарабатывает его сам.`,
        source: 'Boss Fight',
        done: winners.length > 0 || legacy,
        at: p?.firstWinAt ?? 0,
        note: winners.length
          ? `Получено: ${winners.map((f) => FIGHTERS[f].name).join(', ')}`
          : p?.attempts
            ? `Лучший результат: фаза ${p.bestPhase}/3`
            : 'Нужно 5 побед бойцом в Classic Duel',
        reward: def.rewards.firstWin.cosmetic,
        art: 'belt',
        fighters: winners,
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
      fighters: null,
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
        fighters: null,
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
        fighters: null,
      });
    }
    return out;
  }
}
