import { FAME_TIERS, GOALS, LEVEL_THRESHOLDS, LEVEL_TITLES, REWARDS, type GoalDef, type GoalId, type StageId } from '../config/career';
import type { CosmeticId } from '../config/cosmetics.config';
import { CARDS, COMBOS, NEW_CARDS, UNIVERSAL_CARDS } from '../config/cards';
import { DIFFICULTIES, FIGHTERS, FIGHTER_ORDER, RIVAL_ORDER } from '../config/fighters';
import type { CardId, Difficulty, FighterId, RivalId } from '../config/types';
import type { MatchResultData } from '../combat/types';
import { careerStages, currentStage, type StageView } from './careerStages';
import { Collection } from './Collection';
import type { SaveData, SaveSystem } from './SaveSystem';

export interface RewardLine {
  label: string;
  value: number;
  kind: 'money' | 'fans' | 'rep';
  note?: string;
}

export interface MatchRewards {
  money: number;
  fans: number;
  rep: number;
  lines: RewardLine[];
}

export interface MatchOutcome {
  rewards: MatchRewards;
  levelBefore: number;
  levelAfter: number;
  repBefore: number;
  newGoals: GoalId[];
  fighterFansBefore: number;
  /** Alpha 1.5: a producer career stage reached by this result (its reward waits in «Карьера»). */
  newStage: StageId | null;
}

/** Options for matches played inside a game mode (Prime Challenge). */
export interface MatchApplyOptions {
  /** Multiplier on the match money (HIGH STAKES). */
  moneyMult?: number;
  /** Label for the extra money line. */
  moneyLabel?: string;
  /** Classic Duel picks the next opponent after a match; modes leave it alone. */
  rotateRival?: boolean;
  /** A Classic Duel: a win counts towards BOSS FIGHT access (FighterProgress.classicWins). */
  classic?: boolean;
}

/** What a direct payout (Survival, first-clear bonuses) changed. */
export interface GrantOutcome {
  levelBefore: number;
  levelAfter: number;
  repBefore: number;
  newGoals: GoalId[];
  fighterFansBefore: number;
  /** Alpha 1.5: a producer career stage reached by this payout. */
  newStage: StageId | null;
}

export interface LevelInfo {
  level: number;
  title: string;
  cur: number;
  next: number | null;
  progress: number;
}

export function levelFor(rep: number): LevelInfo {
  let lvl = 1;
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) if (rep >= LEVEL_THRESHOLDS[i]) lvl = i + 1;
  const cur = LEVEL_THRESHOLDS[lvl - 1];
  const next = lvl < LEVEL_THRESHOLDS.length ? LEVEL_THRESHOLDS[lvl] : null;
  return {
    level: lvl,
    title: LEVEL_TITLES[lvl - 1],
    cur,
    next,
    progress: next === null ? 1 : (rep - cur) / (next - cur),
  };
}

export function fameTier(fans: number): string {
  let label = FAME_TIERS[0].label;
  for (const t of FAME_TIERS) if (fans >= t.min) label = t.label;
  return label;
}

export function gradeFor(rating: number): string {
  if (rating >= 90) return 'S';
  if (rating >= 75) return 'A';
  if (rating >= 60) return 'B';
  if (rating >= 40) return 'C';
  return 'D';
}

/** Producer career rules on top of the save data. */
export class CareerSystem {
  private store: SaveSystem;

  constructor(store: SaveSystem) {
    this.store = store;
  }

  get s(): SaveData {
    return this.store.data;
  }

  level(): LevelInfo {
    return levelFor(this.s.reputation);
  }

  signedCount(): number {
    return FIGHTER_ORDER.filter((id) => this.s.fighters[id].unlocked).length;
  }

  totalFans(): number {
    return FIGHTER_ORDER.filter((id) => this.s.fighters[id].unlocked).reduce((a, id) => a + this.s.fighters[id].fans, 0);
  }

  difficultyUnlocked(d: Difficulty): boolean {
    return this.level().level >= DIFFICULTIES[d].unlockLevel;
  }

  /** Cards this fighter can put in a deck: the basic six, its signature and the bought shop cards. */
  availableCards(id: FighterId): CardId[] {
    return [...UNIVERSAL_CARDS, FIGHTERS[id].signature, ...NEW_CARDS.filter((c) => this.s.cards.owned.includes(c))];
  }

  setDeck(id: FighterId, deck: CardId[]): void {
    if (deck.length !== 4) return;
    // only cards this fighter may use (another fighter's signature or an unbought card never gets in)
    const allowed = new Set(this.availableCards(id));
    if (deck.some((c) => !allowed.has(c)) || new Set(deck).size !== 4) return;
    this.s.fighters[id].deck = deck.slice();
    this.store.save();
  }

  // ------------------------------------------------- Alpha 1.6 — card shop
  /** The shop cards not bought yet, in shop order. */
  shopCards(): CardId[] {
    return NEW_CARDS.filter((c) => !this.s.cards.owned.includes(c));
  }

  owns(card: CardId): boolean {
    return this.s.cards.owned.includes(card);
  }

  /** The purchase is open: producer level, or the career stage named by the card (whichever comes first). */
  cardOpen(card: CardId): boolean {
    const shop = CARDS[card].shop;
    if (!shop) return false;
    if (this.level().level >= shop.level) return true;
    return !!shop.stage && this.stages().some((st) => st.def.id === shop.stage && st.reached);
  }

  /** How a card opens, in words for the shop («Уровень 3» / «Уровень 5 или этап RISING BROADCAST»). */
  cardRequirement(card: CardId): string {
    const shop = CARDS[card].shop;
    if (!shop) return '';
    const stage = shop.stage ? this.stages().find((st) => st.def.id === shop.stage) : null;
    return stage ? `Уровень продюсера ${shop.level} или этап ${stage.def.title}` : `Уровень продюсера ${shop.level}`;
  }

  canBuyCard(card: CardId): { ok: boolean; reason: string } {
    const shop = CARDS[card].shop;
    if (!shop) return { ok: false, reason: 'Эта карта не продаётся' };
    if (this.owns(card)) return { ok: false, reason: 'Карта уже ваша' };
    if (!this.cardOpen(card)) {
      const req = this.cardRequirement(card);
      return { ok: false, reason: `Откроется: ${req.charAt(0).toLowerCase()}${req.slice(1)}` };
    }
    if (this.s.money < shop.price) return { ok: false, reason: `Не хватает $${shop.price - Math.floor(this.s.money)}` };
    return { ok: true, reason: '' };
  }

  /**
   * Buys a shop card once with the existing money. It goes into the collection for good and
   * for every fighter; the deck is not touched (the player puts it in). Saved at once, so a
   * reload can neither take the money twice nor lose the card.
   */
  buyCard(card: CardId): boolean {
    const c = this.canBuyCard(card);
    if (!c.ok) return false;
    this.s.money -= CARDS[card].shop!.price;
    this.s.cards.owned = NEW_CARDS.filter((x) => x === card || this.s.cards.owned.includes(x));
    this.store.save();
    return true;
  }

  select(id: FighterId): boolean {
    if (!this.s.fighters[id].unlocked) return false;
    this.s.selected = id;
    this.store.save();
    return true;
  }

  canSign(id: FighterId): { ok: boolean; reason: string } {
    const f = FIGHTERS[id];
    const p = this.s.fighters[id];
    if (p.unlocked) return { ok: false, reason: 'Контракт подписан' };
    if (!f.contract) return { ok: false, reason: '' };
    if (this.level().level < f.contract.level) return { ok: false, reason: `Нужен уровень продюсера ${f.contract.level}` };
    if (this.s.money < f.contract.cost) return { ok: false, reason: `Не хватает $${f.contract.cost - Math.floor(this.s.money)}` };
    return { ok: true, reason: '' };
  }

  sign(id: FighterId): GoalId[] {
    const c = this.canSign(id);
    if (!c.ok) return [];
    this.s.money -= FIGHTERS[id].contract!.cost;
    this.s.fighters[id].unlocked = true;
    this.s.selected = id;
    const g = this.refreshGoals();
    this.store.save();
    return g;
  }

  rename(name: string): void {
    const n = name.trim().slice(0, 28);
    if (n) {
      this.s.orgName = n.toUpperCase();
      this.store.save();
    }
  }

  pickNextRival(seed: number): RivalId {
    const pool = RIVAL_ORDER.filter((r) => r !== this.s.lastRival);
    const r = pool[Math.abs(Math.floor(seed)) % pool.length];
    this.s.nextRival = r;
    this.store.save();
    return r;
  }

  computeRewards(r: MatchResultData, fighter: FighterId, diff: Difficulty, opts: MatchApplyOptions = {}): MatchRewards {
    const dm = DIFFICULTIES[diff].rewardMult;
    const fans = this.s.fighters[fighter].fans;
    const lines: RewardLine[] = [];
    const key = r.outcome;
    const purse = Math.round(REWARDS.purse[key] * dm);
    lines.push({
      label: key === 'win' ? 'Гонорар за победу' : key === 'draw' ? 'Гонорар за ничью' : 'Гонорар за выход',
      value: purse,
      kind: 'money',
      note: dm > 1 ? `×${dm} сложность` : undefined,
    });
    let money = purse;
    if (r.method === 'ko' && key === 'win') {
      const b = Math.round(REWARDS.koBonus * dm);
      lines.push({ label: 'Бонус за нокаут', value: b, kind: 'money' });
      money += b;
    }
    const ratingMoney = Math.round(r.rating * REWARDS.ratingMoney * dm);
    lines.push({ label: `Рейтинг шоу ${r.rating}`, value: ratingMoney, kind: 'money', note: 'реклама в эфире' });
    money += ratingMoney;
    const combos = Math.min(REWARDS.comboCap, r.combos);
    if (combos > 0) {
      const cm = combos * REWARDS.comboMoney;
      lines.push({ label: `Комбо ×${combos}`, value: cm, kind: 'money' });
      money += cm;
    }
    const star = Math.round(Math.min(REWARDS.starPowerCap, Math.sqrt(fans) * REWARDS.starPowerK));
    if (star > 0 && r.method !== 'forfeit') {
      lines.push({ label: 'Спонсоры бойца', value: star, kind: 'money', note: `${fans.toLocaleString('ru-RU')} фанатов` });
      money += star;
    }
    const mm = opts.moneyMult ?? 1;
    if (mm !== 1 && r.method !== 'forfeit') {
      const extra = Math.round(money * (mm - 1));
      lines.push({ label: opts.moneyLabel ?? 'Бонус режима', value: extra, kind: 'money', note: `×${mm}` });
      money += extra;
    }
    if (r.method === 'forfeit') {
      money = Math.round(money * 0.3);
      lines.push({ label: 'Штраф за сдачу', value: 0, kind: 'money', note: '−70%' });
    }
    const fanBase = REWARDS.fans[key] * dm;
    const fanMult = REWARDS.fansRatingBase + (r.rating / 100) * REWARDS.fansRatingK;
    const gainedFans = r.method === 'forfeit' ? 0 : Math.round(fanBase * fanMult);
    lines.push({ label: 'Новые фанаты', value: gainedFans, kind: 'fans', note: `×${fanMult.toFixed(2)} от рейтинга` });
    const rep = Math.max(0, Math.round(REWARDS.rep[key] * dm + r.rating / REWARDS.repRatingDiv) - (r.method === 'forfeit' ? 6 : 0));
    lines.push({ label: 'Репутация продюсера', value: rep, kind: 'rep' });
    return { money, fans: gainedFans, rep, lines };
  }

  /** Apply a finished match to the save. */
  applyMatch(r: MatchResultData, fighter: FighterId, diff: Difficulty, rival: RivalId, opts: MatchApplyOptions = {}): MatchOutcome {
    const s = this.s;
    const rewards = this.computeRewards(r, fighter, diff, opts);
    const stageBefore = this.stage().index;
    const levelBefore = this.level().level;
    const repBefore = s.reputation;
    const fp = s.fighters[fighter];
    const fighterFansBefore = fp.fans;
    s.money += rewards.money;
    s.totalEarned += rewards.money;
    s.reputation += rewards.rep;
    s.fansEarned += rewards.fans;
    fp.fans += rewards.fans;
    s.matches++;
    fp.matches++;
    if (r.outcome === 'win') {
      s.wins++;
      fp.wins++;
      if (opts.classic) fp.classicWins++;
      if (diff === 'pro') s.proWins++;
      if (diff === 'champion') s.championWins++;
    } else if (r.outcome === 'loss') {
      s.losses++;
      fp.losses++;
    } else {
      s.draws++;
      fp.draws++;
    }
    // Alpha 1.8 — win streaks, here with the wins and losses and nowhere else: the producer's and
    // this fighter's. A win extends both, a loss (a forfeit too) or a draw ends both; the records
    // never go down. Other fighters' streaks wait for their own next result.
    const st = s.streak;
    if (r.outcome === 'win') {
      st.current++;
      st.best = Math.max(st.best, st.current);
      fp.streak++;
      fp.bestStreak = Math.max(fp.bestStreak, fp.streak);
    } else {
      st.current = 0;
      fp.streak = 0;
    }
    s.bestRating = Math.max(s.bestRating, r.rating);
    fp.bestRating = Math.max(fp.bestRating, r.rating);
    s.bestCombosInMatch = Math.max(s.bestCombosInMatch, r.combos);
    s.bestPerfectsInMatch = Math.max(s.bestPerfectsInMatch, r.perfects);
    const newGoals = this.refreshGoals();
    if (opts.rotateRival !== false) {
      s.lastRival = rival;
      this.pickNextRival(s.seed + s.matches * 31);
    }
    s.seed = (s.seed * 1103515245 + 12345) % 2147483647;
    this.store.save();
    return { rewards, levelBefore, levelAfter: this.level().level, repBefore, newGoals, fighterFansBefore, newStage: this.newStageSince(stageBefore) };
  }

  /**
   * Pay a reward that is not a regular match (Survival marathon, first-clear
   * bonuses). Money, reputation and the fighter's fans go through the same
   * career counters as match rewards; the caller saves.
   */
  grant(reward: { money: number; fans: number; rep: number }, fighter: FighterId): GrantOutcome {
    const s = this.s;
    const stageBefore = this.stage().index;
    const levelBefore = this.level().level;
    const repBefore = s.reputation;
    const fp = s.fighters[fighter];
    const fighterFansBefore = fp.fans;
    const money = Math.max(0, Math.round(reward.money));
    const fans = Math.max(0, Math.round(reward.fans));
    const rep = Math.max(0, Math.round(reward.rep));
    s.money += money;
    s.totalEarned += money;
    s.reputation += rep;
    s.fansEarned += fans;
    fp.fans += fans;
    const newGoals = this.refreshGoals();
    return { levelBefore, levelAfter: this.level().level, repBefore, newGoals, fighterFansBefore, newStage: this.newStageSince(stageBefore) };
  }

  goalProgress(g: GoalDef): number {
    const s = this.s;
    switch (g.id) {
      case 'first_win':
        return Math.min(g.target, s.wins);
      case 'combo_3':
        return Math.min(g.target, s.bestCombosInMatch);
      case 'rating_70':
        return Math.min(g.target, s.bestRating);
      case 'perfect_3':
        return Math.min(g.target, s.bestPerfectsInMatch);
      case 'fans_2500':
        return Math.min(g.target, s.fansEarned);
      case 'sign_second':
        return Math.min(g.target, this.signedCount());
      case 'pro_win':
        return Math.min(g.target, s.proWins);
      case 'champion_win':
        return Math.min(g.target, s.championWins);
    }
  }

  /** Marks newly completed goals; returns their ids. */
  refreshGoals(): GoalId[] {
    const fresh: GoalId[] = [];
    for (const g of GOALS) {
      const st = this.s.goals[g.id];
      if (!st.done && this.goalProgress(g) >= g.target) {
        st.done = true;
        fresh.push(g.id);
      }
    }
    return fresh;
  }

  /** Goals and career stages whose reward is waiting (menu badge). */
  unclaimed(): number {
    return GOALS.filter((g) => this.s.goals[g.id].done && !this.s.goals[g.id].claimed).length + this.stages().filter((st) => st.reached && !st.claimed).length;
  }

  // ------------------------------------------------------------ career stages
  /** Alpha 1.5: ROOKIE PRODUCER → RISING BROADCAST → PRIME TIME STAR → LEGENDARY PRODUCTION. */
  stages(): StageView[] {
    return careerStages(this.s);
  }

  stage(): StageView {
    return currentStage(this.s);
  }

  /** The stage reached now if it is higher than stage `index` (for "new stage" notices), else null. */
  newStageSince(index: number): StageId | null {
    const st = this.stage();
    return st.index > index ? st.def.id : null;
  }

  /** The first stage not reached yet (null at the top). */
  nextStage(): StageView | null {
    return this.stages().find((st) => !st.reached) ?? null;
  }

  /**
   * Pays a reached stage's reward once: money, reputation and (stages 3 and 4) a
   * cosmetic that goes straight into MY COLLECTION. A second claim does nothing.
   */
  claimStage(id: StageId): { money: number; rep: number; cosmetic: CosmeticId | null; cosmeticNew: boolean } | null {
    const st = this.stages().find((x) => x.def.id === id);
    if (!st || !st.reached || st.claimed || !st.def.reward) return null;
    const r = st.def.reward;
    this.s.careerClaimed.push(id);
    this.s.money += r.money;
    this.s.reputation += r.rep;
    let cosmeticNew = false;
    if (r.cosmetic) cosmeticNew = new Collection(this.store).grant(r.cosmetic, `career-${id}`);
    this.refreshGoals();
    this.store.save();
    return { money: r.money, rep: r.rep, cosmetic: r.cosmetic ?? null, cosmeticNew };
  }

  claim(id: GoalId): { money: number; rep: number } | null {
    const g = GOALS.find((x) => x.id === id);
    const st = this.s.goals[id];
    if (!g || !st.done || st.claimed) return null;
    st.claimed = true;
    this.s.money += g.reward.money;
    this.s.reputation += g.reward.rep;
    this.refreshGoals();
    this.store.save();
    return g.reward;
  }

  comboHints(deck: CardId[]): string[] {
    const out: string[] = [];
    for (const c of COMBOS) {
      const a = c.first.find((x) => deck.includes(x));
      const b = c.second.find((x) => deck.includes(x));
      if (a && b) out.push(c.id);
    }
    return out;
  }
}
