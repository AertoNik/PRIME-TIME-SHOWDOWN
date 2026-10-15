// Headless checks for the seasonal event system (npm run events).
// Uses a fake clock and an in-memory save, so no browser is needed.
import { EVENTS } from '../src/config/events.config';
import type { MatchResultData } from '../src/combat/types';
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

const T = (iso: string) => Date.parse(iso);
let now = T('2026-10-15T12:00:00Z');
const clock = () => now;
const auto = { mode: 'auto' as const, forcedEventId: 'none' };

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

const checks: [string, boolean][] = [];
const check = (name: string, pass: boolean) => checks.push([name, pass]);

// ---------------------------------------------------------------- calendar
const store = new MemSave();
const em = new EventManager(store as unknown as SaveSystem, { clock, settings: auto });
check('before start: no active event, Halloween announced', em.active === null && em.upcoming?.id === 'halloween-2026' && em.themeId === 'default');
check('before start: matches give nothing', em.applyMatch(null, result({}), 'rookie') === null);
now = T('2026-10-20T00:00:00Z');
check('start boundary (inclusive) activates Halloween', em.refresh() && em.active?.id === 'halloween-2026' && em.themeId === 'halloween');
check('event is playable (quests + currency)', em.playable);

// ------------------------------------------------------------------ quests
const id = em.active!.id;
let out = em.applyMatch(id, result({ outcome: 'win', rating: 86, combos: 4, comboList: ['counter_strike', 'electro_blast', 'iron_rush', 'superstar'], perfects: 2 }), 'pro');
check('win with rating 86 + 4 combos pays 4+2+2+3 = 11 tokens', out?.tokens === 11 && em.tokens() === 11);
check('quest progress counted from the match', em.quests().find((q) => q.def.id === 'combo_carnival')!.progress === 4);
check('PRIME TIME FRIGHT (rating 80+) completed', !!out?.completed.find((q) => q.id === 'prime_fright'));
check('NIGHT CHAMPION completed on Pro', !!out?.completed.find((q) => q.id === 'night_champion'));
out = em.applyMatch(id, result({ outcome: 'loss', method: 'forfeit', rating: 95, combos: 9, perfects: 9 }), 'champion');
check('forfeit gives no tokens and no progress', out?.tokens === 0 && em.quests().find((q) => q.def.id === 'midnight_marathon')!.progress === 1);
const loss = em.applyMatch(id, result({ outcome: 'loss', method: 'time', rating: 40, combos: 0, comboList: [] }), 'rookie');
check('loss counts as a match but not as a win', loss?.tokens === 0 && em.quests().find((q) => q.def.id === 'first_night')!.progress === 1 && em.quests().find((q) => q.def.id === 'midnight_marathon')!.progress === 2);

// -------------------------------------------------------------- claiming
const before = em.tokens();
const paid = em.claimQuest('prime_fright');
check('claim pays the quest reward', paid === 40 && em.tokens() === before + 40);
check('second claim of the same quest is refused', em.claimQuest('prime_fright') === null && em.tokens() === before + 40);
check('unfinished quest cannot be claimed', em.claimQuest('midnight_marathon') === null);

// ------------------------------------------------------------- daily cap
for (let i = 0; i < 12; i++) em.applyMatch(id, result({ rating: 90, combos: 3 }), 'rookie');
const p = store.data.events[id];
check('daily cap: at most 60 tokens from matches per day', p.dayTokens === 60);
now = T('2026-10-21T12:00:00Z');
const nextDay = em.applyMatch(id, result({ rating: 90, combos: 3 }), 'rookie');
check('cap resets on the next day', (nextDay?.tokens ?? 0) > 0);

// ------------------------------------------------------- shop + cosmetics
check('tokens so far: 11 + 40 claim, capped day, next day', em.tokens() === 111);
store.data.events[id].tokens = 300; // pretend a few more days of play
const t0 = em.tokens();
const r1 = em.buy('card_pumpkin');
check('buying the card style spends 120 tokens', r1.ok && em.tokens() === t0 - 120 && em.owns('card_pumpkin'));
check('new item is equipped automatically', em.isEquipped('card_pumpkin'));
check('buying the same item again is refused', !em.buy('card_pumpkin').ok && em.tokens() === t0 - 120);
store.data.events[id].tokens = 5;
check('not enough tokens: refused', !em.buy('victory_pumpkin').ok && !em.owns('victory_pumpkin'));
check('unequip / equip owned item', em.setEquipped('card_pumpkin', false) && !em.isEquipped('card_pumpkin') && em.setEquipped('card_pumpkin', true) && em.isEquipped('card_pumpkin'));
check('cannot equip an item not owned', !em.setEquipped('frame_spooky', true));

// ------------------------------------------------------------ grand prize
for (const q of EVENTS[0].quests) store.data.events[id].quests[q.id] = { p: q.target, claimed: store.data.events[id].quests[q.id]?.claimed ?? false };
check('grand prize claimable after 6+ quests', em.canClaimGrand());
check('grand prize granted once', em.claimGrand() === 'title_halloween_champion' && em.claimGrand() === null && em.owns('title_halloween_champion'));

// ----------------------------------------------------------- persistence
const reloaded = new EventManager({ data: sanitize(JSON.parse(JSON.stringify(store.data))), save() {} } as unknown as SaveSystem, { clock, settings: auto });
check('after reload: tokens, quests and items restored', reloaded.tokens() === em.tokens() && reloaded.owns('card_pumpkin') && reloaded.owns('title_halloween_champion') && reloaded.quests().find((q) => q.def.id === 'prime_fright')!.claimed);

// ---------------------------------------------------------- season over
now = T('2026-11-04T00:00:00Z');
check('end boundary (exclusive) closes the event', em.refresh() && em.active === null && em.themeId === 'default');
check('after the event: quests and shop closed', em.claimQuest('first_night') === null && !em.buy('frame_spooky').ok && em.applyMatch(null, result({}), 'pro') === null);
check('after the event: cosmetics stay owned and equipped', em.owns('card_pumpkin') && em.isEquipped('card_pumpkin') && store.data.cosmetics.history.length === 2);

// --------------------------------------------------------------- manual
const winter = new EventManager(new MemSave() as unknown as SaveSystem, { clock, settings: { mode: 'manual', forcedEventId: 'winter-preview' } });
check('manual winter preview: winter theme, no quests', winter.themeId === 'winter' && !winter.playable && winter.pending() === 0);
const forced = new EventManager(new MemSave() as unknown as SaveSystem, { clock: () => T('2026-01-01T00:00:00Z'), settings: { mode: 'manual', forcedEventId: 'halloween-2026' } });
check('manual Halloween works outside its dates', forced.themeId === 'halloween' && forced.playable);
const broken = new EventManager(new MemSave() as unknown as SaveSystem, { clock, settings: { mode: 'manual', forcedEventId: 'no-such-event' } });
check('unknown event id falls back to the standard theme', broken.themeId === 'default' && broken.active === null);

// ------------------------------------------------------------- migration
const v2 = { version: 2, money: 5000, reputation: 300, settings: { sound: true, music: true, quality: 'auto', camera: 'reduced' } };
const m2 = sanitize(v2);
check('Alpha 1.1 save (v2) loads with empty events/cosmetics', m2.money === 5000 && m2.settings.camera === 'reduced' && Object.keys(m2.events).length === 0 && m2.cosmetics.owned.length === 0);
const junk = sanitize({ events: { x: { tokens: -5, quests: { a: { p: 'x' } }, bought: ['nope', 'card_pumpkin'] } }, cosmetics: { owned: ['card_pumpkin', 'fake'], equipped: { cardStyle: 'card_pumpkin', title: 'title_halloween_champion' } } });
check('corrupt event data is cleaned', junk.events.x.tokens === 0 && junk.events.x.bought.join() === 'card_pumpkin' && junk.cosmetics.owned.join() === 'card_pumpkin' && !junk.cosmetics.equipped.title);

let ok = true;
for (const [name, pass] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
  ok &&= pass;
}
console.log(ok ? `events: OK (${checks.length} checks)` : 'events: FAILED');
if (!ok) (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1;
