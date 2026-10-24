import type { ArenaId } from '../config/arenas.config';
import type { CosmeticId, CosmeticSlot } from '../config/cosmetics.config';
import { EVENTS, eventSettings, plural, type EventDef, type EventSettings, type QuestDef, type QuestMetric } from '../config/events.config';
import { DIFFICULTY_ORDER, FIGHTERS } from '../config/fighters';
import type { Difficulty, FighterId } from '../config/types';
import type { MatchResultData } from '../combat/types';
import { Collection } from './Collection';
import { inRoster } from './roster';
import { emptyEventProgress, type EventProgress, type SaveSystem } from './SaveSystem';

/**
 * Source of "now". The published game uses the device clock (Date.now), which a
 * player can change: fine for a free local event, not a security boundary. A
 * future server version only needs to swap this for server time.
 */
export type Clock = () => number;

export interface QuestView {
  def: QuestDef;
  progress: number;
  done: boolean;
  claimed: boolean;
}

export interface MatchEventOutcome {
  eventId: string;
  tokens: number;
  lines: { label: string; value: number }[];
  capped: boolean;
  /** Quests that became finished with this match (reward waits in Events). */
  completed: QuestDef[];
}

export type BuyResult = { ok: true } | { ok: false; reason: string };

const COMBO_ULTRA = new Set(['superstar', 'electro_blast']);

/** How much one finished match adds to a quest metric. */
export function questIncrement(m: QuestMetric, r: MatchResultData, difficulty: Difficulty): number {
  if (r.method === 'forfeit') return 0;
  const win = r.outcome === 'win';
  switch (m.kind) {
    case 'wins':
      return win ? 1 : 0;
    case 'matches':
      return 1;
    case 'combos':
      return r.combos;
    case 'ultraCombos':
      return r.comboList.filter((c) => COMBO_ULTRA.has(c)).length;
    case 'perfects':
      return r.perfects;
    case 'koWins':
      return win && r.method === 'ko' ? 1 : 0;
    case 'ratingSum':
      return Math.max(0, Math.round(r.rating));
    case 'ratingAtLeast':
      return r.rating >= m.min ? 1 : 0;
    case 'winsOnDifficulty':
      return win && DIFFICULTY_ORDER.indexOf(difficulty) >= DIFFICULTY_ORDER.indexOf(m.min) ? 1 : 0;
  }
}

function localDay(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * Seasonal events: picks the active event (calendar or manual override),
 * tracks quests from real match results, pays seasonal currency, runs the
 * reward shop and owns the player's cosmetics. All state lives in the save.
 */
export class EventManager {
  private store: SaveSystem;
  private clock: Clock;
  private settings: EventSettings;
  private registry: EventDef[];
  active: EventDef | null = null;
  upcoming: EventDef | null = null;
  /** Bumped whenever something visible changes (UI can re-render). */
  version = 0;
  /** Where granted rewards go (shared state: save.cosmetics). */
  readonly collection: Collection;

  constructor(store: SaveSystem, opts: { clock?: Clock; settings?: EventSettings; registry?: EventDef[] } = {}) {
    this.store = store;
    this.clock = opts.clock ?? (() => Date.now());
    this.collection = new Collection(store, () => this.now());
    this.settings = opts.settings ?? eventSettings;
    this.registry = opts.registry ?? EVENTS;
    this.refresh();
  }

  now(): number {
    return this.clock();
  }

  find(id: string): EventDef | null {
    return this.registry.find((e) => e.id === id) ?? null;
  }

  /** Re-evaluate the calendar. Returns true when the active event changed. */
  refresh(): boolean {
    const before = this.active?.id ?? null;
    const now = this.now();
    let active: EventDef | null = null;
    if (this.settings.mode === 'manual') {
      active = this.find(this.settings.forcedEventId); // unknown id or 'none' -> standard theme
    } else {
      active = this.registry.find((e) => this.isRunning(e, now)) ?? null;
    }
    this.active = active;
    // manual mode shows exactly the forced event: no calendar teasers
    this.upcoming = active || this.settings.mode === 'manual'
      ? null
      : this.registry
          .filter((e) => e.start && e.announceDays > 0 && Date.parse(e.start) > now && Date.parse(e.start) - now <= e.announceDays * 86400000)
          .sort((a, b) => Date.parse(a.start!) - Date.parse(b.start!))[0] ?? null;
    const changed = before !== (active?.id ?? null);
    if (changed) this.version++;
    return changed;
  }

  isRunning(e: EventDef, now = this.now()): boolean {
    if (!e.start || !e.end) return false;
    const a = Date.parse(e.start);
    const b = Date.parse(e.end);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    return now >= a && now < b;
  }

  get themeId(): string {
    return this.active?.themeId ?? 'default';
  }

  /**
   * Has quests/currency (winter preview is theme-only). A manual preview pays only
   * inside the event's real dates, unless the dev build asked for preview rewards.
   * Arena availability and the theme follow `themeId`, never this flag.
   */
  get playable(): boolean {
    const e = this.active;
    if (!e || e.quests.length === 0 || !e.currency) return false;
    if (this.settings.mode === 'manual' && !this.settings.previewRewards && !this.isRunning(e)) return false;
    return true;
  }

  /** ms until the active event ends (Infinity for manual previews without dates). */
  timeLeft(): number {
    const e = this.active;
    if (!e?.end) return Infinity;
    return Math.max(0, Date.parse(e.end) - this.now());
  }

  timeToStart(e: EventDef): number {
    return e.start ? Math.max(0, Date.parse(e.start) - this.now()) : Infinity;
  }

  // ---------------------------------------------------------------- progress
  progress(id: string): EventProgress {
    const all = this.store.data.events;
    if (!all[id]) all[id] = emptyEventProgress();
    return all[id];
  }

  quests(e: EventDef | null = this.active): QuestView[] {
    if (!e) return [];
    const p = this.store.data.events[e.id];
    return e.quests.map((def) => {
      const st = p?.quests[def.id];
      const progress = Math.min(def.target, st?.p ?? 0);
      return { def, progress, done: progress >= def.target, claimed: !!st?.claimed };
    });
  }

  questsDone(e: EventDef | null = this.active): number {
    return this.quests(e).filter((q) => q.done).length;
  }

  /** Number of things waiting for the player (claimable quests + grand prize). */
  pending(): number {
    if (!this.playable) return 0;
    const q = this.quests().filter((x) => x.done && !x.claimed).length;
    return q + (this.canClaimGrand() ? 1 : 0);
  }

  /**
   * Count a finished match toward the active event. Call once per match with
   * the event that was active when the match started.
   */
  applyMatch(eventId: string | null, r: MatchResultData, difficulty: Difficulty, arena?: ArenaId): MatchEventOutcome | null {
    const e = eventId ? this.find(eventId) : null;
    if (!e || !e.currency || !e.earnings || e.quests.length === 0) return null;
    const p = this.progress(e.id);
    const completed: QuestDef[] = [];
    for (const q of e.quests) {
      const st = (p.quests[q.id] ??= { p: 0, claimed: false });
      if (st.p >= q.target) continue;
      const inc = questIncrement(q.metric, r, difficulty);
      if (inc <= 0) continue;
      st.p = Math.min(q.target, st.p + inc);
      if (st.p >= q.target) completed.push(q);
    }
    // seasonal currency for the match itself
    const lines: { label: string; value: number }[] = [];
    let tokens = 0;
    let capped = false;
    if (r.method !== 'forfeit') {
      const er = e.earnings;
      if (r.outcome === 'win' && er.win > 0) lines.push({ label: 'Победа', value: er.win });
      let rt = 0;
      for (const [min, v] of er.rating) if (r.rating >= min) rt += v;
      if (rt > 0) lines.push({ label: `Рейтинг ${Math.round(r.rating)}`, value: rt });
      const cb = Math.min(er.comboCap, r.combos) * er.perCombo;
      if (cb > 0) lines.push({ label: `Комбо ×${Math.min(er.comboCap, r.combos)}`, value: cb });
      // Alpha 1.7.5: a real win (knockout or on time — never a forfeit) on the season's own set
      const aw = er.arenaWin;
      if (aw && arena === aw.arena && r.outcome === 'win' && (r.method === 'ko' || r.method === 'time') && aw.tokens > 0) lines.push({ label: aw.label, value: aw.tokens });
      tokens = lines.reduce((a, l) => a + l.value, 0);
      const day = localDay(this.now());
      if (p.day !== day) {
        p.day = day;
        p.dayTokens = 0;
      }
      const room = Math.max(0, er.dailyCap - p.dayTokens);
      if (tokens > room) {
        tokens = room;
        capped = true;
      }
      p.dayTokens += tokens;
      p.tokens += tokens;
      p.earned += tokens;
    }
    this.version++;
    this.store.save();
    return { eventId: e.id, tokens, lines, capped, completed };
  }

  /**
   * Alpha 1.7.5: the season's bonus for a win on this set while the event really pays
   * (null otherwise) — shown in the arena picker.
   */
  arenaBonus(arena: ArenaId): { tokens: number; unit: string } | null {
    const e = this.active;
    const aw = e?.earnings?.arenaWin;
    if (!this.playable || !e?.currency || !aw || aw.arena !== arena || aw.tokens <= 0) return null;
    return { tokens: aw.tokens, unit: plural(aw.tokens, e.currency.short) };
  }

  /** Pay out a finished quest once. Returns the tokens paid or null. */
  claimQuest(questId: string): number | null {
    const e = this.active;
    if (!this.playable || !e) return null;
    const q = e.quests.find((x) => x.id === questId);
    const p = this.progress(e.id);
    const st = p.quests[questId];
    if (!q || !st || st.claimed || st.p < q.target) return null;
    st.claimed = true;
    p.tokens += q.reward;
    p.earned += q.reward;
    this.version++;
    this.store.save();
    return q.reward;
  }

  canClaimGrand(): boolean {
    const e = this.active;
    if (!this.playable || !e?.grandPrize) return false;
    const p = this.store.data.events[e.id];
    return !p?.grandClaimed && this.questsDone(e) >= e.grandPrize.questsNeeded;
  }

  claimGrand(): CosmeticId | null {
    const e = this.active;
    if (!e?.grandPrize || !this.canClaimGrand()) return null;
    this.progress(e.id).grandClaimed = true;
    this.grant(e.grandPrize.cosmetic, e.id);
    this.version++;
    this.store.save();
    return e.grandPrize.cosmetic;
  }

  tokens(e: EventDef | null = this.active): number {
    return e ? (this.store.data.events[e.id]?.tokens ?? 0) : 0;
  }

  buy(id: CosmeticId): BuyResult {
    const e = this.active;
    if (!this.playable || !e) return { ok: false, reason: 'Обмен доступен только во время события' };
    const item = e.shop.find((s) => s.cosmetic === id);
    if (!item) return { ok: false, reason: 'Этого предмета нет в обмене' };
    if (this.owns(id)) return { ok: false, reason: 'Уже в коллекции' };
    const p = this.progress(e.id);
    const lack = item.cost - p.tokens;
    if (lack > 0) return { ok: false, reason: `Не хватает ${lack} ${plural(lack, e.currency!.short)}` };
    p.tokens -= item.cost;
    p.spent += item.cost;
    if (!p.bought.includes(id)) p.bought.push(id);
    this.grant(id, e.id);
    this.version++;
    this.store.save();
    return { ok: true };
  }

  // ------------------------------------------------------ Alpha 1.7: stars
  /** The seasonal star `id` on sale in the running event's exchange, with its price (null otherwise). */
  fighterOffer(id: FighterId): { cost: number; event: EventDef } | null {
    const e = this.active;
    if (!this.playable || !e?.fighters) return null;
    const item = e.fighters.find((x) => x.fighter === id);
    return item ? { cost: item.cost, event: e } : null;
  }

  /**
   * Alpha 1.8.8: the season whose exchange opens the star `id` and where we are in its calendar
   * (PRIME SHOP reads it — one calendar for the event and the shop).
   */
  fighterSeason(id: FighterId): { event: EventDef; phase: 'before' | 'running' | 'after' } | null {
    const e = this.registry.find((x) => x.fighters?.some((f) => f.fighter === id));
    if (!e) return null;
    const now = this.now();
    const phase = this.isRunning(e, now) ? 'running' : e.end && now >= Date.parse(e.end) ? 'after' : 'before';
    return { event: e, phase };
  }

  /** In the producer's roster (a seasonal star stays there for good once opened). */
  /** In the roster: opened for tokens / signed (the save) or by a confirmed PRIME SHOP purchase (1.8.8). */
  ownsFighter(id: FighterId): boolean {
    return inRoster(this.store.data, id);
  }

  /**
   * Who the roster shows: every contract fighter; a seasonal star once owned, or while its event
   * runs (locked, with its price). Before and after its season an unopened star stays out of sight.
   */
  fighterVisible(id: FighterId): boolean {
    if (!FIGHTERS[id].seasonal) return true;
    return this.ownsFighter(id) || this.fighterOffer(id) !== null;
  }

  /**
   * Opens a seasonal star once, during its event, for its price in the event's currency. The
   * tokens, the record and the fighter are written together and saved at once, so a reload can
   * neither take the tokens twice nor lose the fighter; an owned star is never charged again.
   */
  buyFighter(id: FighterId): BuyResult {
    const e = this.active;
    if (!this.playable || !e) return { ok: false, reason: 'Открыть бойца можно только во время события' };
    const item = e.fighters?.find((x) => x.fighter === id);
    if (!item) return { ok: false, reason: 'Этого бойца нет в обмене' };
    const s = this.store.data;
    if (this.ownsFighter(id)) return { ok: false, reason: 'Боец уже в вашем составе' };
    const p = this.progress(e.id);
    const lack = item.cost - p.tokens;
    if (lack > 0) return { ok: false, reason: `Не хватает ${lack} ${plural(lack, e.currency!.short)}` };
    p.tokens -= item.cost;
    p.spent += item.cost;
    if (!p.fighters.some((f) => f.id === id)) p.fighters.push({ id, at: this.now() });
    s.fighters[id].unlocked = true;
    s.selected = id;
    this.version++;
    this.store.save();
    return { ok: true };
  }

  // --------------------------------------------------------------- cosmetics
  // Alpha 1.5: the event only *grants* rewards; ownership and equipment live in
  // MY COLLECTION (src/meta/Collection.ts), so seasonal items outlive the season.
  owns(id: CosmeticId): boolean {
    return this.collection.owns(id);
  }

  /** Add to the collection once; newly obtained items are equipped right away. */
  private grant(id: CosmeticId, eventId: string): void {
    this.collection.grant(id, eventId);
  }

  equipped(slot: CosmeticSlot): CosmeticId | null {
    return this.collection.equipped(slot);
  }

  isEquipped(id: CosmeticId): boolean {
    return this.collection.isEquipped(id);
  }

  /** Equip an owned item, or take it off with `on = false` (delegates to the collection). */
  setEquipped(id: CosmeticId, on: boolean): boolean {
    if (!this.collection.setEquipped(id, on)) return false;
    this.version++;
    return true;
  }
}
