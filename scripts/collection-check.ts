// Headless checks for Alpha 1.5: MY COLLECTION (the single owner of cosmetics) and the
// producer career stages (npm run collection). In-memory save, fake clock, no browser.
import { CAREER_STAGES } from '../src/config/career';
import { COSMETICS, COSMETIC_ORDER } from '../src/config/cosmetics.config';
import { FIGHTERS, FIGHTER_ORDER } from '../src/config/fighters';
import type { MatchResultData } from '../src/combat/types';
import { CareerSystem } from '../src/meta/CareerSystem';
import { Collection } from '../src/meta/Collection';
import { EventManager } from '../src/meta/EventManager';
import { defaultSave, sanitize, type SaveData, type SaveSystem } from '../src/meta/SaveSystem';

class MemSave {
  data: SaveData = defaultSave();
  saves = 0;
  save(): void {
    this.saves++;
    this.data = sanitize(JSON.parse(JSON.stringify(this.data))); // round-trip like localStorage
  }
  get persistent(): boolean {
    return true;
  }
  reset(): void {
    this.data = defaultSave();
  }
}

const checks: [string, boolean][] = [];
const check = (name: string, pass: boolean) => checks.push([name, pass]);
const T = (iso: string) => Date.parse(iso);
let now = T('2026-10-25T12:00:00Z');
const clock = () => now;

function result(p: Partial<MatchResultData>): MatchResultData {
  return {
    outcome: 'win',
    method: 'ko',
    rating: 70,
    peakRating: 80,
    avgRating: 60,
    bestCombo: null,
    combos: 1,
    comboList: ['counter_strike'],
    perfects: 1,
    damageDealt: 9000,
    damageTaken: 4000,
    cardsUsed: 10,
    duration: 65,
    playerHpFrac: 0.6,
    enemyHpFrac: 0,
    finisher: false,
    ...p,
  };
}

// ------------------------------------------------------------ collection
{
  const store = new MemSave();
  const col = new Collection(store, clock);
  check('collection: a new save owns nothing, nothing equipped', col.cosmetics().every((v) => !v.owned && !v.equipped) && col.freshCount() === 0);
  const first = col.grant('frame_spooky', 'halloween-2026');
  const second = col.grant('frame_spooky', 'halloween-2026');
  check('collection: an item is granted once (second grant changes nothing)', first && !second && store.data.cosmetics.owned.filter((id) => id === 'frame_spooky').length === 1 && store.data.cosmetics.history.filter((h) => h.id === 'frame_spooky').length === 1);
  check('collection: a new item is equipped in its slot and marked NEW', col.isEquipped('frame_spooky') && col.freshCount() === 1);
  col.markAllSeen();
  check('collection: opening the collection clears NEW marks', col.freshCount() === 0 && store.data.cosmetics.seen.includes('frame_spooky'));
  check('collection: an item not owned cannot be equipped', !col.setEquipped('frame_legendary', true) && col.equipped('broadcastFrame') === 'frame_spooky');
  col.grant('frame_legendary', 'career-legendary');
  check('collection: one item per slot (the newer frame replaced the old one)', col.equipped('broadcastFrame') === 'frame_legendary' && !col.isEquipped('frame_spooky') && col.owns('frame_spooky'));
  col.setEquipped('frame_spooky', true);
  check('collection: equip swaps the slot back', col.equipped('broadcastFrame') === 'frame_spooky');
  col.setEquipped('frame_spooky', false);
  check('collection: unequip leaves the slot on the standard look', col.equipped('broadcastFrame') === null && col.owns('frame_spooky'));
  store.save();
  const re = new Collection(store, clock);
  check('collection: owned / equipped / seen survive a reload', re.owns('frame_legendary') && re.owns('frame_spooky') && re.equipped('broadcastFrame') === null && store.data.cosmetics.seen.includes('frame_spooky') && !store.data.cosmetics.seen.includes('frame_legendary'));
}

// sources and categories
{
  const seasonal = COSMETIC_ORDER.filter((id) => COSMETICS[id].source === 'season');
  check('collection: the Victor reward is a BOSS FIGHT item, not a Halloween one', COSMETICS.title_prime_legend.source === 'boss' && !seasonal.includes('title_prime_legend') && COSMETICS.title_prime_legend.eventId !== 'halloween-2026');
  check('collection: career items are their own category', COSMETICS.title_prime_star.source === 'career' && COSMETICS.frame_legendary.source === 'career' && !seasonal.includes('title_prime_star'));
  check('collection: every item has a how-to-get hint and a source label', COSMETIC_ORDER.every((id) => COSMETICS[id].howTo.length > 4 && COSMETICS[id].sourceLabel.length > 2));
}

// seasonal rewards outlive the season
{
  const store = new MemSave();
  now = T('2026-10-25T12:00:00Z');
  const em = new EventManager(store as unknown as SaveSystem, { clock, settings: { mode: 'auto', forcedEventId: 'none' } });
  em.refresh();
  em.progress('halloween-2026').tokens = 9999;
  const bought = em.buy('card_pumpkin');
  now = T('2026-12-01T12:00:00Z');
  em.refresh();
  store.save();
  const col = new Collection(store, clock);
  check('collection: a seasonal item bought during Halloween is still owned and equipped after it ends', bought.ok && em.active === null && col.owns('card_pumpkin') && col.isEquipped('card_pumpkin'));
  check('collection: the event no longer sells it, the collection still equips it', !em.buy('card_pumpkin').ok && col.setEquipped('card_pumpkin', false) && col.setEquipped('card_pumpkin', true));
}

// migration of 1.4.x saves
{
  const v7 = {
    version: 7,
    money: 4321,
    reputation: 500,
    wins: 40,
    fansEarned: 30000,
    bestRating: 88,
    proWins: 8,
    fighters: { ray: { unlocked: true, fans: 9000, wins: 30 }, bruno: { unlocked: true }, nika: { unlocked: true }, vega: { unlocked: true } },
    cosmetics: { owned: ['card_pumpkin', 'title_prime_legend', 'card_pumpkin'], equipped: { cardStyle: 'card_pumpkin', title: 'title_prime_legend' }, history: [{ id: 'card_pumpkin', event: 'halloween-2026', at: 5 }] },
    modes: { survival: { runs: 3, completions: 1 }, challenges: { spotlight: { attempts: 2, clears: 1, firstClearAt: 9 }, high_stakes: { attempts: 1, clears: 1, firstClearAt: 11 } }, boss: { vale: { attempts: 3, wins: 1, firstWinAt: 12, winsByFighter: { ray: 1 } } } },
    arena: 'casino',
  };
  const s = sanitize(JSON.parse(JSON.stringify(v7)));
  check('migration: a v7 save becomes v11 with money, wins, records and the arena kept', s.version === 11 && s.money === 4321 && s.wins === 40 && s.modes.boss.vale.wins === 1 && s.arena === 'casino');
  check('migration: duplicate owned items collapse to one', s.cosmetics.owned.length === 2 && s.cosmetics.owned.filter((id) => id === 'card_pumpkin').length === 1);
  check('migration: equipped items and history are kept (the Victor title now worn by Ray, who beat him)', s.cosmetics.equipped.cardStyle === 'card_pumpkin' && s.cosmetics.personalEquipped.ray?.title === 'title_prime_legend' && s.cosmetics.equipped.title === undefined && s.cosmetics.history.length === 1);
  check('migration: items owned before 1.5 are not flagged NEW', s.cosmetics.seen.length === 2 && new Collection({ data: s, save() {} }).freshCount() === 0);
  check('migration: no career reward is paid automatically', s.careerClaimed.length === 0);
  check('migration: Kai and Rina join locked with their default decks', FIGHTER_ORDER.includes('kai') && FIGHTER_ORDER.includes('rina') && !s.fighters.kai.unlocked && !s.fighters.rina.unlocked && s.fighters.kai.deck.includes('bank_shot') && s.fighters.rina.deck.includes('false_start'));
  const sel = sanitize({ ...v7, selected: 'rina' });
  check('migration: a locked new fighter cannot be the selected one', sel.selected !== 'rina');
  const junk = sanitize({ ...v7, careerClaimed: ['rising', 'rising', 'moon', 3], cosmetics: { owned: ['card_pumpkin'], seen: ['frame_spooky', 'card_pumpkin', 'nope'] } });
  check('migration: corrupt career marks / seen marks are cleaned', junk.careerClaimed.length === 1 && junk.careerClaimed[0] === 'rising' && junk.cosmetics.seen.length === 1 && junk.cosmetics.seen[0] === 'card_pumpkin');
}

// ------------------------------------------------------------ career stages
{
  const store = new MemSave();
  const career = new CareerSystem(store as unknown as SaveSystem);
  check('stages: four stages in order', CAREER_STAGES.map((s) => s.id).join(',') === 'rookie,rising,star,legendary');
  check('stages: a new producer is a ROOKIE PRODUCER, RISING BROADCAST is next', career.stage().def.id === 'rookie' && career.nextStage()?.def.id === 'rising' && career.stages().filter((s) => s.reached && !s.claimed).length === 0);
  // star milestones without the rising ones: stages are reached in order
  const s = store.data;
  s.fansEarned = 25000;
  s.proWins = 6;
  s.modes.survival.completions = 1;
  check('stages: reached in order (later milestones alone do not skip a stage)', career.stage().def.id === 'rookie');
  s.wins = 9;
  s.bestRating = 75;
  s.fighters.bruno.unlocked = true;
  check('stages: one milestone short (9/10 wins) is not enough', career.stage().def.id === 'rookie' && career.nextStage()!.milestones.filter((m) => !m.done).length === 1);
  const money0 = s.money;
  const rep0 = s.reputation;
  const out = career.applyMatch(result({ rating: 72 }), 'ray', 'rookie', 'dex', { classic: true });
  check('stages: the match that completes the stage reports it', out.newStage === 'rising' && career.stage().def.id === 'rising');
  check('stages: the reward is not paid until claimed', career.unclaimed() >= 1 && store.data.careerClaimed.length === 0);
  const moneyBefore = store.data.money;
  const repBefore = store.data.reputation;
  const r1 = career.claimStage('rising');
  const r2 = career.claimStage('rising');
  check('stages: RISING BROADCAST pays $600 and +40 rep exactly once', !!r1 && r1.money === 600 && r1.rep === 40 && r2 === null && store.data.money === moneyBefore + 600 && store.data.reputation === repBefore + 40);
  check('stages: money/rep came from the match and the claim only', store.data.money > money0 && store.data.reputation > rep0);
  check('stages: an unreached stage cannot be claimed', career.claimStage('star') === null && career.claimStage('legendary') === null);
  // PRIME TIME STAR: 4 fighters and 2 challenges (store.data is a fresh object after each save)
  const d = store.data;
  d.fighters.nika.unlocked = true;
  d.fighters.vega.unlocked = true;
  for (const id of ['spotlight', 'high_stakes']) d.modes.challenges[id] = { attempts: 1, clears: 1, firstClearAt: 5, best: 0, bestAt: 0, bestFighter: null };
  check('stages: PRIME TIME STAR reached from real records', career.stage().def.id === 'star');
  const r3 = career.claimStage('star');
  const col = new Collection(store, clock);
  check('stages: PRIME TIME STAR title goes into MY COLLECTION (equipped, once)', !!r3 && r3.cosmetic === 'title_prime_star' && r3.cosmeticNew && col.owns('title_prime_star') && col.isEquipped('title_prime_star') && career.claimStage('star') === null);
  store.save();
  check('stages: claimed marks survive a reload', store.data.careerClaimed.includes('rising') && store.data.careerClaimed.includes('star'));
  check('stages: collection shows reached stages as achievements', col.achievements().some((a) => a.id === 'career-star' && a.done) && col.achievements().some((a) => a.id === 'career-legendary' && !a.done));
}

// a long 1.4 career is recognised at once (rewards claimable, not auto-paid, not doubled)
{
  const store = new MemSave();
  const s = store.data;
  Object.assign(s, { wins: 80, fansEarned: 90000, bestRating: 95, proWins: 20, championWins: 5 });
  for (const id of FIGHTER_ORDER) s.fighters[id].unlocked = true;
  s.modes.survival.completions = 2;
  for (const id of ['spotlight', 'high_stakes', 'energy_rush']) s.modes.challenges[id] = { attempts: 1, clears: 1, firstClearAt: 5, best: 0, bestAt: 0, bestFighter: null };
  s.modes.boss.vale = { ...(s.modes.boss.vale ?? {}), attempts: 2, wins: 1, firstWinAt: 7 } as never;
  store.save();
  const career = new CareerSystem(store as unknown as SaveSystem);
  check('veteran save: LEGENDARY PRODUCTION reached straight away', career.stage().def.id === 'legendary' && career.nextStage() === null);
  const money = store.data.money;
  const paid = ['rising', 'star', 'legendary'].map((id) => career.claimStage(id as never));
  check('veteran save: three rewards, each paid once ($600 + $1500 + $3000)', paid.every(Boolean) && store.data.money === money + 5100 && ['rising', 'star', 'legendary'].every((id) => career.claimStage(id as never) === null));
  const col = new Collection(store, clock);
  check('veteran save: LEGENDARY frame owned once', col.owns('frame_legendary') && store.data.cosmetics.owned.filter((id) => id === 'frame_legendary').length === 1);
}

// ------------------------------------------------------------ contracts for the new fighters
{
  const store = new MemSave();
  const career = new CareerSystem(store as unknown as SaveSystem);
  const kai = FIGHTERS.kai.contract!;
  const rina = FIGHTERS.rina.contract!;
  check('contracts: Kai and Rina are signed like the others (producer level + money)', kai.level >= 3 && rina.level >= kai.level && kai.cost > FIGHTERS.nika.contract!.cost && rina.cost >= kai.cost);
  store.data.money = 99999;
  check('contracts: a rookie producer cannot sign Kai yet', !career.canSign('kai').ok && /уровень/.test(career.canSign('kai').reason));
  store.data.reputation = 5000;
  check('contracts: with the level and the money Kai and Rina can be signed', career.canSign('kai').ok && career.canSign('rina').ok);
  career.sign('rina');
  check('contracts: signing Rina charges the fee once and selects her', store.data.fighters.rina.unlocked && store.data.money === 99999 - rina.cost && store.data.selected === 'rina' && !career.canSign('rina').ok);
}

// ------------------------------------------------------------ Alpha 1.5.5: personal rewards
{
  const store = new MemSave();
  const col = new Collection(store, clock);
  const id = 'title_prime_legend' as const;
  check('personal: a personal reward needs a fighter', !col.grant(id, 'boss-vale'));
  const ray = col.grant(id, 'boss-vale', 'ray');
  check('personal: Ray beats Victor — the title is Ray\'s and Ray wears it', ray && col.ownsFor(id, 'ray') && col.isEquipped(id, 'ray') && col.equippedFor('title', 'ray') === id);
  check('personal: Bruno has not beaten Victor — he cannot wear it', !col.ownsFor(id, 'bruno') && col.equippedFor('title', 'bruno') === null && !col.setEquipped(id, true, 'bruno'));
  check('personal: the common slot never carries a personal title', col.equipped('title') === null);
  const again = col.grant(id, 'boss-vale', 'ray');
  check('personal: a second win by Ray adds nothing', !again && store.data.cosmetics.personal[id]?.length === 1 && store.data.cosmetics.owned.filter((x) => x === id).length === 1);
  col.grant(id, 'boss-vale', 'bruno');
  check('personal: Bruno beats Victor himself — now both own it, one definition, two owners', col.owners(id).join() === 'ray,bruno' && col.ownsFor(id, 'bruno') && store.data.cosmetics.owned.filter((x) => x === id).length === 1);
  col.setEquipped(id, false, 'ray');
  check('personal: Ray takes it off, Bruno still wears his', !col.isEquipped(id, 'ray') && col.isEquipped(id, 'bruno'));
  col.grant('title_prime_star', 'career-star');
  col.setEquipped('title_prime_star', true);
  check('personal: common producer titles still work for every fighter', col.equippedFor('title', 'nika') === 'title_prime_star' && col.equippedFor('title', 'ray') === 'title_prime_star');
  check('personal: a fighter\'s own title wins over the common one', col.equippedFor('title', 'bruno') === id);
  col.setEquipped('title_prime_star', true, 'bruno');
  check('personal: putting on a common title for Bruno takes his personal one off (what you tap is what you see)', col.equippedFor('title', 'bruno') === 'title_prime_star' && col.owners(id).includes('bruno'));
  store.save();
  const re = new Collection(store, clock);
  check('personal: owners and per-fighter equipment survive a reload', re.owners(id).join() === 'ray,bruno' && !re.isEquipped(id, 'bruno') && !re.isEquipped(id, 'ray') && re.equipped('title') === 'title_prime_star');
  // the achievement reads the real boss records (who has a win over the champion)
  store.data.modes.boss.vale = { attempts: 3, wins: 2, firstWinAt: 5, bestTime: 90, bestRating: 80, bestPhase: 3, bestBossHp: 0, bestFighter: 'ray', winsByFighter: { ray: 1, bruno: 1 }, history: [] };
  const ach = re.achievements().find((a) => a.id === 'boss-vale');
  check('personal: the boss achievement lists who earned it', !!ach && ach.done && (ach.fighters ?? []).join() === 'ray,bruno' && ach.note.includes('РЭЙ') && ach.note.includes('БРУНО'));
}
// legacy title the records cannot tie to anyone: assigned once by the player
{
  const store = new MemSave();
  store.data = sanitize({ version: 8, cosmetics: { owned: ['title_prime_legend'], equipped: { title: 'title_prime_legend' } }, fighters: { bruno: { unlocked: true } } });
  const col = new Collection(store, clock);
  const money = store.data.money;
  check('legacy: an old title with no fighter on record is kept, not given to everyone', store.data.cosmetics.owned.includes('title_prime_legend') && col.unassigned().includes('title_prime_legend') && col.equippedFor('title', 'ray') === null && col.equippedFor('title', 'bruno') === null);
  check('legacy: the collection badge asks the player to look', col.freshCount() >= 1);
  const ok1 = col.assignLegacy('title_prime_legend', 'bruno');
  const ok2 = col.assignLegacy('title_prime_legend', 'ray');
  check('legacy: the player names Bruno once; a second choice is refused; no money paid', ok1 && !ok2 && col.owners('title_prime_legend').join() === 'bruno' && col.isEquipped('title_prime_legend', 'bruno') && store.data.money === money);
  store.save();
  check('legacy: the choice is saved and not asked again', new Collection(store, clock).unassigned().length === 0 && store.data.cosmetics.personal.title_prime_legend?.join() === 'bruno');
}
// seasonal items stay a surprise until obtained
{
  const store = new MemSave();
  const col = new Collection(store, clock);
  const seasonalIds = COSMETIC_ORDER.filter((id) => COSMETICS[id].source === 'season');
  check('seasons: unearned seasonal items are not shown in the collection at all', col.cosmetics().every((v) => v.def.source !== 'season') && seasonalIds.every((id) => !col.visible(id)));
  check('seasons: boss and career items stay visible as goals', col.visible('title_prime_legend') && col.visible('frame_legendary'));
  col.grant('card_pumpkin', 'halloween-2026');
  check('seasons: an obtained seasonal item appears — and only that one', col.visible('card_pumpkin') && col.cosmetics().filter((v) => v.def.source === 'season').map((v) => v.def.id).join() === 'card_pumpkin');
  now = T('2027-02-01T12:00:00Z');
  check('seasons: after the season it is still there and wearable', col.visible('card_pumpkin') && col.setEquipped('card_pumpkin', true) && col.equipped('cardStyle') === 'card_pumpkin');
}

let ok = true;
for (const [name, pass] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
  ok &&= pass;
}
console.log(ok ? `collection & career: OK (${checks.length} checks)` : 'collection & career: FAILED');
const proc = (globalThis as { process?: { exitCode?: number } }).process;
if (!ok && proc) proc.exitCode = 1;
