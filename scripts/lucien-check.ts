// Headless checks for Alpha 1.7 — BLOOD MOON PREMIERE (npm run lucien): LUCIEN «The Night Star».
// His place in the roster and the decks, the dual-mode VAMPIRE CANE BLASTER (strikes up close, bolts
// from afar, one shared attack timer, never through a STAGE BARRIER), BAT BITE and its bleed (no
// stacking, DASH / SHIELD / FALSE START / barriers answer it, the champion resists it), how he is
// opened in the Halloween Premiere exchange (UTC dates, price, no double charge, kept forever, saves),
// the event economy behind his price, his rig and animation, and the proof that the other six
// fighters fight exactly as before 1.7. In-memory save, fake clock, no browser.
import { BOSSES } from '../src/config/boss.config';
import { CARD_TUNING } from '../src/config/balance';
import { CARDS, COMBOS, NEW_CARDS, TAKE_CARDS, UNIVERSAL_CARDS } from '../src/config/cards';
import { EVENTS } from '../src/config/events.config';
import { FIGHTERS, FIGHTER_ORDER, RIVALS, RIVAL_ORDER } from '../src/config/fighters';
import { LOOKS } from '../src/config/looks';
import { SURVIVAL } from '../src/config/modes.config';
import type { CardId, Difficulty, FighterId, RivalId } from '../src/config/types';
import { Match } from '../src/combat/Match';
import type { MatchEvent } from '../src/combat/types';
import { CareerSystem } from '../src/meta/CareerSystem';
import { EventManager } from '../src/meta/EventManager';
import { setEntitlements } from '../src/meta/entitlements';
import { inRoster } from '../src/meta/roster';
import { defaultSave, sanitize, validDeck, type SaveData, type SaveSystem } from '../src/meta/SaveSystem';
import { defaultInput } from '../src/render/FighterAnimator';
import { ModelCache } from '../src/render/ModelCache';
import { Vector3 } from 'three';
import { runMatch, type Mode } from './bots';
import { fs } from './lib/node';

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
const DT = 1 / 60;
const L = FIGHTERS.lucien;
const HW = EVENTS.find((e) => e.id === 'halloween-2026')!;
const AUTO = { mode: 'auto' as const, forcedEventId: 'none' };

// ------------------------------------------------------------- the roster
{
  check('roster: LUCIEN «THE NIGHT STAR» is the seventh fighter', FIGHTER_ORDER.length === 7 && FIGHTER_ORDER[6] === 'lucien' && L.name === 'LUCIEN' && L.nickname === 'THE NIGHT STAR');
  check('roster: a seasonal star of Halloween Premiere — no contract to sign', L.contract === null && L.seasonal?.eventId === 'halloween-2026' && !!LOOKS[L.look] && L.look === 'lucien');
  check('roster: never an opponent (not in any rotation, Survival, Challenge or Boss)', !RIVAL_ORDER.includes('lucien' as RivalId) && !Object.values(RIVALS).some((r) => r.look === 'lucien' || r.archetype === 'lucien') && SURVIVAL.waves.length > 0 && !Object.values(BOSSES).some((b) => (b.rival as string) === 'lucien'));
  check('weapon: VAMPIRE CANE BLASTER — bolts from afar, strikes up close (one weapon, one attack timer)', L.stats.attack.weapon === 'cane' && !!L.stats.attack.melee && L.stats.attack.melee.exit > L.stats.attack.melee.enter && L.stats.attack.melee.exit <= L.stats.attack.melee.reach + 0.55 * 0.5);
  const sig = CARDS.bat_bite;
  check('BAT BITE: his exclusive signature, 3 energy, 220 + 90/s × 3 s', L.signature === 'bat_bite' && sig.exclusive === 'lucien' && sig.cost === 3 && CARD_TUNING.bat_bite.damage === 220 && CARD_TUNING.bat_bite.bleed === 90 && CARD_TUNING.bat_bite.bleedTime === 3);
  check('BAT BITE: not universal, not in the card shop, not replayable by SECOND TAKE', !UNIVERSAL_CARDS.includes('bat_bite') && !NEW_CARDS.includes('bat_bite') && !sig.shop && !TAKE_CARDS.includes('bat_bite'));
  const inCombos = COMBOS.filter((c) => c.second.includes('bat_bite') || c.first.includes('bat_bite')).map((c) => c.id);
  check(`BAT BITE combos: only SUPERSTAR MOVE (OVERDRIVE → signature), like every signature (${inCombos.join(', ')})`, inCombos.length === 1 && inCombos[0] === 'superstar');
  check('decks: his default deck is valid, the standard four cards', validDeck('lucien', L.defaultDeck).join() === L.defaultDeck.join() && L.defaultDeck.length === 4 && L.defaultDeck.includes('bat_bite'));
  check('decks: nobody else can take BAT BITE (another fighter\'s deck with it resets)', validDeck('ray', ['dash', 'power_shot', 'shield', 'bat_bite']).join() === FIGHTERS.ray.defaultDeck.join());
  const store = new MemSave();
  const career = new CareerSystem(store as unknown as SaveSystem);
  check('decks: BAT BITE is offered to Lucien only', career.availableCards('lucien').includes('bat_bite') && FIGHTER_ORDER.filter((f) => f !== 'lucien').every((f) => !career.availableCards(f).includes('bat_bite')));
  check('career: he cannot be signed with money (no contract)', !career.canSign('lucien').ok && career.sign('lucien').length === 0 && !store.data.fighters.lucien.unlocked);
}

// ------------------------------------------------------------- the saves
{
  const d = defaultSave();
  check('save: a new career has Lucien locked, with his default deck', !d.fighters.lucien.unlocked && d.fighters.lucien.deck.join() === L.defaultDeck.join() && d.version === 12);
  // a 1.6.6 save knows nothing about him
  const old = { version: 11, money: 2600, reputation: 300, matches: 30, wins: 20, selected: 'kai', fighters: { ray: { unlocked: true, wins: 12, matches: 18 }, kai: { unlocked: true, wins: 8, matches: 12, deck: ['dash', 'shield', 'overdrive', 'bank_shot'] } }, events: { 'halloween-2026': { tokens: 140, earned: 140, quests: { first_night: { p: 3, claimed: true } } } } };
  const s = sanitize(JSON.parse(JSON.stringify(old)));
  check('save: a 1.6.6 career loads untouched — Lucien locked, everything else kept', !s.fighters.lucien.unlocked && s.selected === 'kai' && s.money === 2600 && s.fighters.ray.wins === 12 && s.fighters.kai.deck.includes('bank_shot') && s.events['halloween-2026'].tokens === 140 && s.events['halloween-2026'].fighters.length === 0);
  // 1.8.8 stage 4: the save may keep a seasonal star «selected» (a PRIME SHOP purchase opens him without being
  // written into the save) — but a locked Lucien is never PLAYED: the game plays Ray unless the server's
  // confirmed purchase opens him, and the server refuses such a cloud save without one (validate.js)
  const sneaky = sanitize({ ...old, selected: 'lucien' });
  setEntitlements([]);
  const src = (p: string) => fs.readFileSync(p, 'utf8') as string;
  check('save: a locked Lucien is never played — the game plays Ray unless a purchase confirmed by the server opens him', !sneaky.fighters.lucien.unlocked && !inRoster(sneaky, 'lucien') && /const fighter = inRoster\(s, s\.selected\) \? s\.selected : 'ray';/.test(src('src/game/Game.ts')) && /paid\.indexOf\(s\.selected\) >= 0/.test(src('backend/pb_hooks/lib/validate.js')));
  // an owner: the fighter, his deck, his record and the purchase all round-trip
  const own = sanitize(
    JSON.parse(
      JSON.stringify({
        ...old,
        selected: 'lucien',
        fighters: { ...old.fighters, lucien: { unlocked: true, fans: 4100, wins: 9, losses: 3, matches: 12, classicWins: 6, bestRating: 91, deck: ['dash', 'power_shot', 'shield', 'bat_bite'] } },
        events: { 'halloween-2026': { tokens: 20, earned: 520, spent: 500, fighters: [{ id: 'lucien', at: T('2026-10-26T18:00:00Z') }, { id: 'lucien', at: 1 }, { id: 'ray', at: 5 }] } },
      }),
    ),
  );
  check('save: an owner keeps Lucien, his deck, wins, Classic wins and best rating', own.fighters.lucien.unlocked && own.selected === 'lucien' && own.fighters.lucien.deck.join() === 'dash,power_shot,shield,bat_bite' && own.fighters.lucien.wins === 9 && own.fighters.lucien.classicWins === 6 && own.fighters.lucien.bestRating === 91);
  const rec = own.events['halloween-2026'].fighters;
  check('save: the purchase record survives (once, only seasonal stars, with its date)', rec.length === 1 && rec[0].id === 'lucien' && rec[0].at === T('2026-10-26T18:00:00Z') && own.events['halloween-2026'].spent === 500);
}

// ------------------------------------------------------ the Halloween exchange
{
  check('exchange: LUCIEN is on sale in Halloween Premiere for 500 PUMPKIN TOKENS', HW.fighters?.length === 1 && HW.fighters[0].fighter === 'lucien' && HW.fighters[0].cost === 500 && HW.currency?.id === 'pumpkin');
  // UTC boundaries of the season (start inclusive, end exclusive)
  const at = (iso: string) => {
    const st = new MemSave();
    return new EventManager(st as unknown as SaveSystem, { clock: () => T(iso), settings: AUTO });
  };
  const b1 = at('2026-10-19T23:59:59Z');
  const b2 = at('2026-10-20T00:00:00Z');
  const b3 = at('2026-11-03T23:59:59Z');
  const b4 = at('2026-11-04T00:00:00Z');
  check('dates (UTC): 19 Oct 23:59:59 — not yet: no offer, Lucien out of sight', !b1.playable && b1.fighterOffer('lucien') === null && !b1.fighterVisible('lucien'));
  check('dates (UTC): 20 Oct 00:00:00 — on sale, shown locked', b2.playable && b2.fighterOffer('lucien')?.cost === 500 && b2.fighterVisible('lucien'));
  check('dates (UTC): 3 Nov 23:59:59 — still on sale', b3.playable && b3.fighterOffer('lucien') !== null);
  check('dates (UTC): 4 Nov 00:00:00 — over: no offer, an unopened Lucien disappears again', !b4.playable && b4.fighterOffer('lucien') === null && !b4.fighterVisible('lucien'));
  check('dates: every contract fighter is always visible', FIGHTER_ORDER.filter((f) => f !== 'lucien').every((f) => b1.fighterVisible(f) && b4.fighterVisible(f)));
  // a manual theme preview outside the dates is not an exchange
  const pv = new EventManager(new MemSave() as unknown as SaveSystem, { clock: () => T('2026-10-10T12:00:00Z'), settings: { mode: 'manual', forcedEventId: 'halloween-2026' } });
  check('preview: a manual Halloween look outside the dates sells nothing', pv.fighterOffer('lucien') === null && !pv.buyFighter('lucien').ok);

  // the purchase
  let now = T('2026-10-25T12:00:00Z');
  const store = new MemSave();
  const em = new EventManager(store as unknown as SaveSystem, { clock: () => now, settings: AUTO });
  em.progress('halloween-2026').tokens = 499;
  const poor = em.buyFighter('lucien');
  check(`buy: 499 tokens are not enough (${poor.ok ? '' : poor.reason}) — nothing changes`, !poor.ok && !store.data.fighters.lucien.unlocked && em.tokens() === 499 && /Не хватает 1 жетон/.test(poor.ok ? '' : poor.reason));
  em.progress('halloween-2026').tokens = 640;
  const saves = store.saves;
  const ok = em.buyFighter('lucien');
  const p = store.data.events['halloween-2026'];
  check('buy: with 640 tokens he opens — 500 taken once, recorded, selected, saved at once', ok.ok && store.data.fighters.lucien.unlocked && p.tokens === 140 && p.spent === 500 && p.fighters.length === 1 && p.fighters[0].at === now && store.data.selected === 'lucien' && store.saves === saves + 1);
  const again = em.buyFighter('lucien');
  check('buy: a second time is refused and charges nothing', !again.ok && em.tokens() === 140 && store.data.events['halloween-2026'].fighters.length === 1);
  // a reload (fresh managers on the saved data) changes nothing
  const reloaded = new MemSave();
  reloaded.data = sanitize(JSON.parse(JSON.stringify(store.data)));
  const em2 = new EventManager(reloaded as unknown as SaveSystem, { clock: () => now, settings: AUTO });
  check('reload: still owned, still 140 tokens, no second charge possible', reloaded.data.fighters.lucien.unlocked && em2.tokens() === 140 && !em2.buyFighter('lucien').ok && em2.tokens() === 140);
  const career = new CareerSystem(reloaded as unknown as SaveSystem);
  check('career: an owned Lucien counts in the roster and can be selected', career.signedCount() === 2 && career.select('lucien'));
  // after the season
  now = T('2026-11-10T12:00:00Z');
  em2.refresh();
  check('after the event: an owner keeps him — visible, selectable, playable in Classic', !em2.playable && em2.ownsFighter('lucien') && em2.fighterVisible('lucien') && career.select('lucien'));
  const col = em2.collection.seasonalFighters();
  check('after the event: MY COLLECTION lists the seasonal star with its season and date', col.length === 1 && col[0].id === 'lucien' && col[0].eventId === 'halloween-2026' && col[0].at === T('2026-10-25T12:00:00Z'));
  const late = new MemSave();
  late.data.events['halloween-2026'] = { ...late.data.events['halloween-2026'], tokens: 900, earned: 900, spent: 0, quests: {}, bought: [], fighters: [], grandClaimed: false, day: '', dayTokens: 0 };
  const em3 = new EventManager(late as unknown as SaveSystem, { clock: () => now, settings: AUTO });
  check('after the event: 900 unspent tokens no longer open him, he stays locked and hidden', !em3.buyFighter('lucien').ok && !late.data.fighters.lucien.unlocked && !em3.fighterVisible('lucien') && em3.collection.seasonalFighters().length === 0);
  // boss access works for him like for everyone
  const bossStore = new MemSave();
  bossStore.data.fighters.lucien.unlocked = true;
  check('boss access: the same 5 Classic Duel wins rule applies to Lucien', BOSSES.vale.unlock.classicWins === 5);
}

// ------------------------------------------------------- the economy (price)
{
  const quests = HW.quests.reduce((a, q) => a + q.reward, 0);
  const days = (T(HW.end!) - T(HW.start!)) / 86400000;
  const cap = HW.earnings!.dailyCap;
  const shop = HW.shop.reduce((a, s) => a + s.cost, 0);
  check(`economy: ${quests} from all quests + ${cap}/day over ${days} days = ${quests + cap * days} at most`, quests === 305 && days === 15 && cap === 60);
  check(`economy: not on day one (at most ${quests + cap} the first day < 500)`, quests + cap < 500);
  check(`economy: an every-day player can still get Lucien and all four cosmetics (${500 + shop} ≤ ${quests + cap * days})`, 500 + shop <= quests + cap * days);
  // real matches through the real exchange: a deliberate player and a random-card one, 5 a day
  class Mem {
    data: SaveData = defaultSave();
    save(): void {}
  }
  const dayToLucien = (mode: Mode, diff: Difficulty, fighter: FighterId, perDay: number) => {
    let now = T('2026-10-20T09:00:00Z');
    const st = new Mem();
    const em = new EventManager(st as unknown as SaveSystem, { clock: () => now, settings: AUTO });
    let seed = 101;
    let tokens = 0;
    let n = 0;
    for (let day = 0; day < 15; day++) {
      now = T('2026-10-20T09:00:00Z') + day * 86400000;
      for (let k = 0; k < perDay; k++) {
        const { m } = runMatch(fighter, RIVAL_ORDER[seed % 4], diff, mode, seed * 31);
        seed++;
        tokens += em.applyMatch('halloween-2026', m.result!, diff)?.tokens ?? 0;
        n++;
        for (const q of em.quests()) if (q.done && !q.claimed) em.claimQuest(q.def.id);
        if (em.tokens() >= 500) return { day: day + 1, perMatch: tokens / n };
      }
    }
    return { day: 99, perMatch: tokens / n };
  };
  const strong = dayToLucien('combo', 'pro', 'ray', 5);
  const weak = dayToLucien('mash', 'rookie', 'ray', 5);
  check(`economy: a deliberate player (5 fights a day, ~${strong.perMatch.toFixed(1)} tokens a fight) opens him on day ${strong.day}`, strong.day >= 3 && strong.day <= 6);
  check(`economy: a random-card player (5 a day, ~${weak.perMatch.toFixed(1)} tokens a fight) still opens him on day ${weak.day} of 15`, weak.day >= 6 && weak.day <= 11);
}

// ----------------------------------------------------------------- combat
function lucienMatch(rival: RivalId = 'dex', deck: CardId[] = L.defaultDeck, seed = 7, boss?: string): Match {
  const m = new Match({ fighter: 'lucien', deck, rival, difficulty: 'rookie', seed, fans: 0, boss, mods: boss ? { duration: BOSSES.vale.duration, introTime: BOSSES.vale.introTime, timeUpRule: 'rival' } : undefined });
  while (m.phase !== 'fight') {
    m.step(DT);
    m.drainEvents();
  }
  m.ais[1].hold = true;
  return m;
}
function run(m: Match, secs: number, every?: () => void): MatchEvent[] {
  const out: MatchEvent[] = [];
  for (let i = 0; i < Math.round(secs / DT); i++) {
    every?.();
    m.step(DT);
    out.push(...m.drainEvents());
  }
  return out;
}
/** Pin both fighters `d` m apart on the z axis (the AI still aims, but nobody walks). */
function pin(m: Match, d: number): () => void {
  return () => {
    const [a, b] = m.fighters;
    a.x = a.px = 0;
    a.z = a.pz = d / 2;
    b.x = b.px = 0;
    b.z = b.pz = -d / 2;
    a.vx = a.vz = b.vx = b.vz = 0;
    a.shoveX = a.shoveZ = b.shoveX = b.shoveZ = 0;
  };
}
{
  // the cane: strikes up close, bolts from afar, never both, one cadence
  const m = lucienMatch();
  const far = run(m, 4, pin(m, 5));
  const close = run(m, 4, pin(m, 1.7));
  const lu = (e: MatchEvent[], t: string) => e.filter((x) => (x.type === t && 'side' in x && x.side === 0) || false).length;
  const shotsFar = far.filter((e) => e.type === 'shot' && e.side === 0 && e.kind === 'auto').length;
  const strikesClose = lu(close, 'strike');
  const shotsClose = close.filter((e) => e.type === 'shot' && e.side === 0 && e.kind === 'auto').length;
  check(`cane: from afar he shoots (${shotsFar} bolts in 4 s, no strikes)`, shotsFar >= 5 && lu(far, 'strike') === 0);
  check(`cane: up close he strikes instead (${strikesClose} strikes in 4 s, ${shotsClose} bolts while switching)`, strikesClose >= 6 && shotsClose <= 1);
  const mel = L.stats.attack.melee!;
  check(`cane: one attack timer — never more strikes than the interval allows (${strikesClose} ≤ ${Math.ceil(4 / mel.interval) + 1})`, strikesClose <= Math.ceil(4 / mel.interval) + 1);
  const hits = close.filter((e) => e.type === 'hit' && e.source === 0 && e.kind === 'cane');
  check(`cane: strikes land on a body in reach (${hits.length} hits, ${hits[0]?.type === 'hit' ? hits[0].damage : 0} each)`, hits.length >= strikesClose - 2 && hits.every((h) => h.type === 'hit' && h.damage === mel.damage));
  // the contact matches the swing: each 'slash' comes `windup` after its 'strike'
  const m2 = lucienMatch();
  let lastStrike = -1;
  let worst = 0;
  run(m2, 3, () => {
    pin(m2, 1.7)();
    for (const e of m2.events) {
      if (e.type === 'strike' && e.side === 0) lastStrike = m2.time;
      if (e.type === 'slash' && e.side === 0 && lastStrike >= 0) worst = Math.max(worst, Math.abs(m2.time - lastStrike - mel.windup));
    }
  });
  check(`cane: the contact comes exactly at the end of the swing (worst ${(worst * 1000).toFixed(0)} ms off)`, worst <= DT + 1e-6);
  // hysteresis: in the band between enter and exit the mode holds (no flicker)
  const m3 = lucienMatch();
  run(m3, 1.5, pin(m3, 1.7));
  const wasStrike = m3.fighters[0].caneStrike;
  let flips = 0;
  let prev = wasStrike;
  run(m3, 3, () => {
    pin(m3, (mel.enter + mel.exit) / 2)();
    if (m3.fighters[0].caneStrike !== prev) flips++;
    prev = m3.fighters[0].caneStrike;
  });
  check(`cane: between ${mel.enter} and ${mel.exit} m the mode holds (no flicker: ${flips} switches)`, wasStrike && flips === 0);
  run(m3, 1.5, pin(m3, 3.4));
  check('cane: beyond the exit distance he is back to bolts', !m3.fighters[0].caneStrike);
  // a STAGE BARRIER between them stops the cane
  const m4 = lucienMatch('tank');
  const foe = m4.fighters[1];
  run(m4, 0.5, pin(m4, 1.9));
  m4.fighters[1].hp = m4.fighters[1].maxHp;
  m4.objects.list.push({ id: 9999, kind: 'barrier', owner: 1, x: 0, z: 0, fromX: 0, fromZ: 0, dirX: 1, dirZ: 0, radius: 1.35, t: 0, total: 99, stage: 'on', hp: 99999, maxHp: 99999, combo: null, variant: 0 });
  const hp0 = foe.hp;
  const ev4 = run(m4, 2, pin(m4, 1.9));
  check(`cane: never through a STAGE BARRIER (${ev4.filter((e) => e.type === 'slash' && e.outcome === 'blocked').length} strikes rang off it, no damage)`, foe.hp === hp0 && ev4.some((e) => e.type === 'slash' && e.outcome === 'blocked') && !ev4.some((e) => e.type === 'hit' && e.source === 0 && e.kind === 'cane'));
}

// ------------------------------------------------------------- BAT BITE
function bite(m: Match): MatchEvent[] {
  const h = m.hands[0];
  h.energy = 10;
  h.lockout = 0;
  if (!h.hand.includes('bat_bite')) {
    h.hand[0] = 'bat_bite';
    h.version++;
  }
  m.playCard(0, h.hand.indexOf('bat_bite'));
  return m.drainEvents();
}
{
  const m = lucienMatch('dex');
  const foe = m.fighters[1];
  run(m, 0.3, pin(m, 3.2));
  const hp0 = foe.hp;
  const ev = bite(m).concat(run(m, 4.5));
  const biteHit = ev.find((e) => e.type === 'hit' && e.source === 0 && e.kind === 'bite');
  const ticks = ev.filter((e) => e.type === 'hit' && e.source === 0 && e.kind === 'bleed');
  const bleedSum = ticks.reduce((a, e) => a + (e.type === 'hit' ? e.damage : 0), 0);
  check(`bite: the lunge reaches from 3.2 m and bites for ${biteHit?.type === 'hit' ? biteHit.damage : 0}`, !!biteHit && biteHit.type === 'hit' && biteHit.damage === 220 && ev.some((e) => e.type === 'bite' && e.what === 'hit'));
  check(`bite: then the bleed — ${ticks.length} ticks, ${bleedSum} in total (90/s × 3 s), and it ends`, ticks.length === 6 && bleedSum === 270 && foe.bleedTicks === 0 && ev.some((e) => e.type === 'bleedEnd' && e.side === 1));
  check(`bite: ${hp0 - foe.hp} damage in all (no healing for Lucien)`, hp0 - foe.hp >= 490 && m.fighters[0].hp === m.fighters[0].maxHp);
  check('bite: after the bite he springs back out of reach', ev.some((e) => e.type === 'bite' && e.what === 'hit') && Math.hypot(m.fighters[0].x - foe.x, m.fighters[0].z - foe.z) > CARD_TUNING.bat_bite.hitRange);
}
{
  // a second bite refreshes the bleed, never stacks it
  const m = lucienMatch('dex');
  const foe = m.fighters[1];
  run(m, 0.3, pin(m, 3));
  bite(m);
  run(m, 1.2);
  const left = foe.bleedTicks;
  run(m, 0.3, pin(m, 3));
  bite(m);
  run(m, 1.0);
  check(`bleed: a second bite refreshes it (${foe.bleedTicks} ticks left, never more than 6)`, left > 0 && foe.bleedTicks <= 6 && foe.bleedTicks >= 4);
  let maxTicks = 0;
  run(m, 6, () => (maxTicks = Math.max(maxTicks, foe.bleedTicks)));
  check('bleed: never more than one bleed at a time (≤ 6 ticks), over after 3 s', maxTicks <= 6 && foe.bleedTicks === 0);
}
{
  // SHIELD up: the bite is blocked, no bleed
  const m = lucienMatch('tank');
  const foe = m.fighters[1];
  run(m, 0.3, pin(m, 3));
  foe.shield = 3;
  foe.shieldHp = 1100;
  const ev = bite(m).concat(run(m, 2));
  check('defence: a raised SHIELD stops the bite — and so the bleed', ev.some((e) => e.type === 'bite' && e.what === 'blocked') && foe.bleedTicks === 0 && !ev.some((e) => e.type === 'hit' && e.source === 0 && (e.kind === 'bite' || e.kind === 'bleed')));
}
{
  // a SHIELD raised during the bleed soaks the ticks
  const m = lucienMatch('dex');
  const foe = m.fighters[1];
  run(m, 0.3, pin(m, 3));
  bite(m);
  run(m, 0.6);
  foe.shield = 3;
  foe.shieldHp = 1100;
  const hp = foe.hp;
  const ev = run(m, 1.6);
  check('defence: a SHIELD raised during the bleed soaks the ticks', foe.hp === hp && ev.some((e) => e.type === 'block' && e.side === 1));
}
{
  // DASH i-frames: the lunge passes through
  const m = lucienMatch('dex');
  const foe = m.fighters[1];
  run(m, 0.3, pin(m, 3));
  const ev = bite(m).concat(run(m, 0.6, () => (foe.invuln = 0.5)), run(m, 1.2));
  const bitten = ev.some((e) => e.type === 'hit' && e.source === 0 && (e.kind === 'bite' || e.kind === 'bleed'));
  check('defence: DASH i-frames slip the bite — no bite, no bleed, Lucien is left open', !bitten && foe.bleedTicks === 0 && ev.some((e) => e.type === 'dodge' && e.side === 1 && e.perfect) && ev.some((e) => e.type === 'whiff' && e.side === 0));
}
{
  // out of reach: no guaranteed hit
  const m = lucienMatch('dex');
  const foe = m.fighters[1];
  run(m, 0.3, pin(m, 8.5));
  const ev = bite(m).concat(run(m, 1.5, () => {
    foe.x = foe.px = 0;
    foe.z = foe.pz = -4.25;
  }));
  check('reach: from 8.5 m the lunge falls short — a miss, no bite', !ev.some((e) => e.type === 'hit' && e.source === 0 && e.kind === 'bite') && ev.some((e) => e.type === 'whiff' && e.side === 0));
}
{
  // a STAGE BARRIER in the way stops the lunge
  const m = lucienMatch('tank');
  const foe = m.fighters[1];
  run(m, 0.3, pin(m, 4));
  m.objects.list.push({ id: 9998, kind: 'barrier', owner: 1, x: 0, z: 0, fromX: 0, fromZ: 0, dirX: 1, dirZ: 0, radius: 1.35, t: 0, total: 99, stage: 'on', hp: 99999, maxHp: 99999, combo: null, variant: 0 });
  let crossed = false;
  const ev = bite(m).concat(run(m, 1.5, () => {
    foe.x = foe.px = 0;
    foe.z = foe.pz = -2;
    const a = m.fighters[0].action;
    if (a.kind === 'bite' && m.fighters[0].z < 0) crossed = true;
  }));
  check('barrier: the lunge never goes through a STAGE BARRIER (stopped at it, no bite)', !crossed && !ev.some((e) => e.type === 'hit' && e.source === 0 && e.kind === 'bite') && ev.some((e) => e.type === 'bite' && e.what === 'barrier'));
}
{
  // a stun during the coil interrupts it (it is a readable windup)
  const m = lucienMatch('dex');
  run(m, 0.2, pin(m, 3));
  bite(m);
  m.combat.applyStun(m.fighters[0], 1, 1);
  const ev = run(m, 1);
  check('interrupt: SHOCK / a stun during the coil calls the bite off', !ev.some((e) => e.type === 'bite' && e.what === 'rush') && m.fighters[1].bleedTicks === 0);
}
{
  // the champion: half the bleed, poise respected
  const m = lucienMatch('vale', L.defaultDeck, 5, 'vale');
  const boss = m.fighters[1];
  run(m, 0.3, pin(m, 3));
  const ev = bite(m).concat(run(m, 4));
  const ticks = ev.filter((e) => e.type === 'hit' && e.source === 0 && e.kind === 'bleed').length;
  check(`boss: Victor shakes the bleed off twice as fast (${ticks} ticks instead of 6)`, ticks === 3 && BOSSES.vale.poise.bleedMult === 0.5 && boss.bleedTicks === 0);
}
{
  // a bleed can finish a fight; the knockout and the end of the fight clear it
  const m = lucienMatch('dex');
  const foe = m.fighters[1];
  run(m, 0.3, pin(m, 3));
  bite(m);
  run(m, 0.6);
  foe.hp = 40;
  const ev = run(m, 1.5);
  check('bleed: it can deliver the knockout, and stops with it', foe.ko && m.result?.outcome === 'win' && foe.bleedTicks === 0 && ev.some((e) => e.type === 'ko' && e.side === 1));
}
{
  // SUPERSTAR MOVE: OVERDRIVE → BAT BITE boosts the bite (not the bleed)
  const m = lucienMatch('dex', ['overdrive', 'bat_bite', 'dash', 'shield']);
  run(m, 0.3, pin(m, 3));
  const h = m.hands[0];
  h.energy = 10;
  h.lockout = 0;
  m.playCard(0, h.hand.indexOf('overdrive'));
  h.lockout = 0;
  run(m, 0.05);
  h.lockout = 0;
  const ev = m.drainEvents().concat(bite(m), run(m, 3.8));
  const b = ev.find((e) => e.type === 'hit' && e.kind === 'bite');
  const ticks = ev.filter((e) => e.type === 'hit' && e.kind === 'bleed');
  check(`combo: SUPERSTAR MOVE → BAT BITE ×1.4 (${b?.type === 'hit' ? b.damage : 0}), the bleed unchanged (${ticks.length} × ${ticks[0]?.type === 'hit' ? ticks[0].damage : 0})`, ev.some((e) => e.type === 'combo' && e.combo === 'superstar') && b?.type === 'hit' && b.damage === Math.round(220 * 1.4 * 1.2) && ticks.length === 6 && ticks.every((t) => t.type === 'hit' && t.damage === 45));
}
{
  // determinism: the same seed, the same fight
  const a = runMatch('lucien', 'zoe', 'pro', 'combo', 4242);
  const b = runMatch('lucien', 'zoe', 'pro', 'combo', 4242);
  const ra = a.m.result!;
  const rb = b.m.result!;
  check('sim: a Lucien fight is deterministic for a seed', ra.duration === rb.duration && ra.damageDealt === rb.damageDealt && ra.damageTaken === rb.damageTaken && ra.rating === rb.rating);
}

// --------------------------------------------- the other six are untouched
{
  // fingerprints of fixed-seed fights recorded with Alpha 1.6.6 before Lucien existed — re-recorded in 1.9.0 when the
  // fight switched to deterministic math (src/core/dmath.ts): 73 of 78 outcomes identical, wins 45 → 46 (same balance)
  const BASE: Record<string, string> = {
    ray: 'wk4186:17632:13968:88:7|wt4501:14482:6919:88:7|lt4501:12341:13796:81:6|wk3895:15046:8340:86:6|lk3395:13006:14909:70:1|wt4501:14123:8962:71:0|lk3876:12963:15075:29:0|lk3672:12846:15445:67:0|lt4501:15392:13242:90:2|wt4501:11978:7731:61:2|lt4501:9593:14849:60:2|wk4385:15040:12283:91:5|Bl6668:23108:14934',
    bruno: 'lk4306:17523:16868:85:6|wt4501:14794:8048:88:5|lt4501:13665:15045:73:5|wk3516:15029:9603:91:5|lt4501:15864:16374:60:0|wt4501:14150:9733:76:0|wt4501:14928:15216:47:1|wk4253:15158:13097:84:0|lt4501:15409:15633:83:2|wt4501:15881:8142:91:4|wk4407:16196:14229:74:2|wk4213:14994:12021:91:1|Bw6310:24188:15557',
    nika: 'wk3900:17871:13474:87:7|wt4501:17607:6567:88:7|wk3966:16370:12837:87:6|wk4091:15006:8336:88:6|lk3984:12520:13643:38:0|wt4501:13238:7579:69:1|wt4501:14846:12063:70:1|lk4203:12971:13636:56:1|lk3924:13256:13673:46:1|wt4501:15851:6415:79:4|lk4128:14784:13657:56:3|wt4501:14475:11482:79:3|Bw5564:23834:11064',
    vega: 'wk4211:17625:12349:88:7|wt4501:15612:5792:89:9|wt4501:13984:10897:87:4|wk4157:15062:10375:92:7|lk3712:14818:13623:82:2|wt4501:13765:8314:47:0|lk3488:11425:13600:24:0|lk4052:13206:13601:79:2|lk3726:13160:13656:73:3|wt4501:15272:6288:85:6|lk3762:14097:13606:66:5|wt4501:14517:10782:82:2|Bl5816:19534:13760',
    kai: 'wk4124:17602:12754:89:9|wt4501:16768:5119:90:13|lt4501:12162:11393:95:7|wk3852:15011:6946:91:8|lk3519:12221:14507:52:0|wt4501:14188:9865:84:2|lk3501:10760:14460:39:1|lk3729:11525:14401:66:0|lt4501:14105:11885:90:3|wt4501:12389:6456:86:8|lk3419:9513:14752:67:3|wk4394:15034:10709:95:4|Bw6674:23851:11326',
    rina: 'wk3601:17853:10801:87:7|wt4501:16223:6443:88:9|lt4501:12180:13440:88:6|wk3758:15204:6052:91:6|lk3195:13111:13666:88:1|wt4501:15277:9194:84:5|lk3075:9375:13791:30:0|wk4179:15348:13558:95:1|lk3683:13778:13625:85:1|wt4501:10656:7529:11:0|lk3691:13592:13657:75:5|wt4501:14783:10861:96:1|Bw5936:23807:11703',
  };
  const R: RivalId[] = ['dex', 'tank', 'zoe', 'crash'];
  const changed: string[] = [];
  for (const f of ['ray', 'bruno', 'nika', 'vega', 'kai', 'rina'] as FighterId[]) {
    const parts: string[] = [];
    for (const mode of ['combo', 'mash', 'smart'] as Mode[]) {
      for (let i = 0; i < 4; i++) {
        const { m } = runMatch(f, R[i], i % 2 ? 'pro' : 'champion', mode, 777 + i * 131);
        const r = m.result!;
        parts.push(`${r.outcome[0]}${r.method[0]}${Math.round(r.duration * 60)}:${r.damageDealt}:${r.damageTaken}:${r.rating}:${r.combos}`);
      }
    }
    const bd = BOSSES.vale;
    const { m } = runMatch(f, 'vale', 'pro', 'combo', 4242, undefined, { duration: bd.duration, introTime: bd.introTime, timeUpRule: 'rival' }, 'vale');
    const r = m.result!;
    parts.push(`B${r.outcome[0]}${Math.round(r.duration * 60)}:${r.damageDealt}:${r.damageTaken}`);
    if (parts.join('|') !== BASE[f]) changed.push(f);
  }
  check(`the other six fight exactly as recorded (1.6.6, re-recorded 1.9.0) (78 fixed-seed fights incl. the boss)${changed.length ? ' — changed: ' + changed.join(', ') : ''}`, changed.length === 0);
}

// ----------------------------------------------------- balance in the band
{
  const N = 24;
  const rate = (mode: Mode, diff: Difficulty, boss = false, deck?: CardId[]) => {
    let w = 0;
    const bd = BOSSES.vale;
    for (let i = 0; i < N; i++) {
      const { m } = boss
        ? runMatch('lucien', 'vale', 'pro', mode, 5000 + i * 7919, deck, { duration: bd.duration, introTime: bd.introTime, timeUpRule: 'rival' }, 'vale')
        : runMatch('lucien', RIVAL_ORDER[i % 4], diff, mode, 1000 + i * 7919, deck);
      if (m.result!.outcome === 'win') w++;
    }
    return w / N;
  };
  const proCombo = rate('combo', 'pro');
  const champCombo = rate('combo', 'champion');
  const proMash = rate('mash', 'pro');
  const bossTip = rate('combo', 'pro', true, ['dash', 'shield', 'overdrive', 'power_shot']);
  // the other six with the same bot (Alpha 1.6.6 `npm run sim`): Pro combo 97–100%, Champion combo 50–93%, Pro mash 47–97%
  check(`balance: Pro, deliberate play ${Math.round(proCombo * 100)}% (others 97–100%)`, proCombo >= 0.85);
  check(`balance: Champion, deliberate play ${Math.round(champCombo * 100)}% (others 50–93%) — strong, not stronger`, champCombo >= 0.4 && champCombo <= 0.93);
  check(`balance: Pro, random cards ${Math.round(proMash * 100)}% (others 47–97%) — no free wins`, proMash >= 0.2 && proMash <= 0.97);
  check(`balance: BOSS FIGHT with the deck the prep screen suggests (DASH/SHIELD/OVERDRIVE/POWER SHOT) ${Math.round(bossTip * 100)}%`, bossTip >= 0.35);
}

// ------------------------------------------------------- rig and animation
{
  const models = new ModelCache();
  const { rig, anim } = models.get('lucien');
  check('rig: the cane in his right hand, coat tails on their own bone', !!rig.weaponR && !rig.weaponL && !!rig.tail && rig.muzzles.length === 2 && rig.look.weapon === 'cane');
  const tip = new Vector3();
  // the menu: a gentleman's stroll — the cane hangs from the pommel, its tip near (never under) the floor
  anim.reset(0);
  const inp = defaultInput();
  inp.combat = false;
  let lowest = 9;
  for (let i = 0; i < 180; i++) {
    inp.vx = i > 90 ? 0 : 0;
    anim.update(DT, inp);
    rig.root.updateMatrixWorld(true);
    lowest = Math.min(lowest, rig.muzzles[0].getWorldPosition(tip).y);
  }
  check(`pose: standing in the menu the cane's tip stays above the floor (lowest ${lowest.toFixed(2)} m)`, lowest > -0.02 && lowest < 0.6);
  // the fight: the guard, the point before a bolt, the fencing guard up close, the strike
  anim.reset(0);
  inp.combat = true;
  inp.fireIn = -1;
  for (let i = 0; i < 60; i++) anim.update(DT, inp);
  rig.root.updateMatrixWorld(true);
  const guard = rig.muzzles[0].getWorldPosition(new Vector3());
  inp.fireIn = 0.02;
  for (let i = 0; i < 10; i++) anim.update(DT, inp);
  rig.root.updateMatrixWorld(true);
  const point = rig.muzzles[0].getWorldPosition(new Vector3());
  check(`pose: before a bolt the cane comes up and out to point (tip ${guard.z.toFixed(2)} → ${point.z.toFixed(2)} m ahead, straight at the target)`, point.z > guard.z + 0.1 && point.y > 1.0 && Math.abs(point.x) < 0.4);
  inp.fireIn = -1;
  inp.melee = true;
  for (let i = 0; i < 60; i++) anim.update(DT, inp);
  const before = rig.shoulderL.rotation.z;
  anim.strike(0, 0.13);
  let reach = 0;
  for (let i = 0; i < 24; i++) {
    anim.update(DT, inp);
    rig.root.updateMatrixWorld(true);
    reach = Math.max(reach, rig.muzzles[0].getWorldPosition(tip).z);
  }
  check(`pose: the fencing guard raises the free hand behind, the thrust drives the cane out (${reach.toFixed(2)} m)`, before > 0.8 && reach > 1.6);
  // the bite: coil, lunge, leap — finite and back to the guard
  let finite = true;
  inp.melee = false;
  for (const [action, stage, card] of [['windup', null, 'bat_bite'], ['bite', 'rush', null], ['bite', 'leap', null], ['none', null, null]] as const) {
    inp.action = action;
    inp.biteStage = stage;
    inp.actionCard = card;
    inp.actionT = 0;
    inp.actionTotal = 0.3;
    for (let i = 0; i < 20; i++) {
      inp.actionT += DT;
      anim.update(DT, inp);
      for (const o of [rig.spine, rig.shoulderR, rig.shoulderL, rig.legL, rig.legR]) finite &&= Number.isFinite(o.rotation.x) && Number.isFinite(o.rotation.z);
    }
  }
  check('pose: the BAT BITE coil, lunge and leap play and settle back (all finite)', finite && Math.abs(rig.roll.rotation.x) < 0.6);
}

let ok = true;
for (const [name, pass] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
  ok &&= pass;
}
console.log(ok ? `lucien: OK (${checks.length} checks)` : 'lucien: FAILED');
const proc = (globalThis as { process?: { exitCode?: number } }).process;
if (!ok && proc) proc.exitCode = 1;
