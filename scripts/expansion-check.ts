// Headless checks for Alpha 1.9.8 — CONTENT EXPANSION (npm run expansion): ACE (STAR TURN, MAIN EVENT / PERFECT TAKE),
// the three universal cards SHOWTIME, MAGNET PULL and SAFE CUT, their four combos, the AI using them, the safety limits
// (no energy loop, no control loop) and determinism (the same seed replays the same fight, the league included).
// In-memory, no browser, no server.
import { cardPrice, contractCost } from '../src/config/careerPrices';
import { CARD_TUNING, COMBO_TUNING, MATCH, PASSIVE_TUNING } from '../src/config/balance';
import { CARDS, COMBOS, NEW_CARDS, TAKE_CARDS, comboFor } from '../src/config/cards';
import { FIGHTERS, FIGHTER_ORDER, RIVAL_ORDER } from '../src/config/fighters';
import type { ArenaId } from '../src/config/arenas.config';
import type { CardId, ComboId, FighterId, RivalId } from '../src/config/types';
import { Match } from '../src/combat/Match';
import type { MatchEvent } from '../src/combat/types';
import { CareerSystem } from '../src/meta/CareerSystem';
import { defaultSave, sanitize, validDeck, type SaveData, type SaveSystem } from '../src/meta/SaveSystem';
import { CARD_ICONS } from '../src/ui/icons';
import { proc } from './lib/node';

const checks: [string, boolean][] = [];
const check = (name: string, pass: boolean) => checks.push([name, pass]);
const DT = 1 / 60;
const NEW3: CardId[] = ['showtime', 'magnet_pull', 'safe_cut'];

class MemSave {
  data: SaveData = defaultSave();
  save(): void {
    this.data = sanitize(JSON.parse(JSON.stringify(this.data)));
  }
  get persistent(): boolean {
    return true;
  }
  reset(): void {
    this.data = defaultSave();
  }
}

/** A fight that has just started, both brains switched off (positions and cards set by the test). */
function arena(fighter: FighterId = 'ray', rival: RivalId = 'dex', where?: ArenaId): Match {
  const m = new Match({ fighter, deck: FIGHTERS[fighter].defaultDeck, rival, difficulty: 'pro', seed: 77, fans: 0, arena: where });
  for (const ai of m.ais) ai.update = () => {};
  while (m.phase !== 'fight') m.step(DT);
  for (const f of m.fighters) {
    f.intentSpeed = 0;
    f.wantFire = false;
  }
  return m;
}
function aimAt(m: Match): void {
  const [p, e] = m.fighters;
  for (const [a, b] of [
    [p, e],
    [e, p],
  ]) {
    a.aimX = a.cardAimX = a.seenX = b.x;
    a.aimZ = a.cardAimZ = a.seenZ = b.z;
    a.seenVX = b.vx;
    a.seenVZ = b.vz;
  }
}
function place(m: Match, px: number, pz: number, ex: number, ez: number): void {
  const [p, e] = m.fighters;
  p.place(px, pz, Math.atan2(ex - px, ez - pz));
  e.place(ex, ez, Math.atan2(px - ex, pz - ez));
  for (const f of m.fighters) {
    f.vx = f.vz = 0;
    f.hist.length = 0;
  }
  aimAt(m);
}
/** Put `card` in hand slot 0 of `side` with `energy`, no lockout, and play it. */
function play(m: Match, card: CardId, side: 0 | 1 = 0, energy = 10): string | null {
  const h = m.hands[side];
  h.hand = [card, h.hand[1] ?? 'dash', h.hand[2] ?? 'shield'];
  h.energy = energy;
  h.lockout = 0;
  return m.playCard(side, 0);
}
function run(m: Match, secs: number, every?: () => void): MatchEvent[] {
  const out: MatchEvent[] = [];
  for (let i = 0; i < Math.round(secs / DT); i++) {
    aimAt(m);
    every?.();
    m.step(DT);
    out.push(...m.drainEvents());
  }
  return out;
}
const dist = (m: Match) => Math.hypot(m.fighters[1].x - m.fighters[0].x, m.fighters[1].z - m.fighters[0].z);
const hitsOn = (ev: MatchEvent[], side: 0 | 1) => ev.filter((x): x is Extract<MatchEvent, { type: 'hit' }> => x.type === 'hit' && x.side === side);

// ============================================================== registry
{
  check(`registry: 18 shop cards, the three new ones last (${NEW_CARDS.slice(-3).join(', ')})`, NEW_CARDS.length === 18 && NEW_CARDS.slice(-3).join() === NEW3.join() && new Set(NEW_CARDS).size === 18);
  check('registry: exactly the three cards of the brief — no STATIC JAM, no CHAIN REACTION', !('static_jam' in CARDS) && !('chain_reaction' in CARDS) && NEW3.every((c) => c in CARDS));
  check('registry: costs SHOWTIME 2, MAGNET PULL 3, SAFE CUT 2; none is exclusive', CARDS.showtime.cost === 2 && CARDS.magnet_pull.cost === 3 && CARDS.safe_cut.cost === 2 && NEW3.every((c) => !CARDS[c].exclusive));
  check('registry: every new card has an icon, a family, a gesture, a counter text and a shop entry', NEW3.every((c) => CARD_ICONS[c]?.includes('<svg') && !!CARDS[c].family && !!CARDS[c].cast && (CARDS[c].counter?.length ?? 0) > 20 && !!CARDS[c].shop));
  check('registry: career prices on the 1.9.6 curve (SHOWTIME 450, MAGNET PULL 880→900, SAFE CUT 550 → by tier)', cardPrice('showtime') === 450 && cardPrice('magnet_pull') === 900 && cardPrice('safe_cut') === 550);
  check('registry: MAIN EVENT — ACE only, 4 energy, heavy, an icon', CARDS.main_event.exclusive === 'ace' && CARDS.main_event.cost === 4 && FIGHTERS.ace.signature === 'main_event' && CARD_ICONS.main_event?.includes('<svg'));
  check('registry: MAIN EVENT is not a SECOND TAKE card (no echo, no second refund)', !TAKE_CARDS.includes('main_event'));
  check('registry: MAIN EVENT refund is smaller than its cost (no energy loop)', CARD_TUNING.main_event.energyRefund > 0 && CARD_TUNING.main_event.energyRefund < CARDS.main_event.cost / 2);
  const ids: ComboId[] = ['standing_ovation', 'close_up', 'star_pull', 'clean_exit'];
  check('registry: the four new combos exist with a label and a description', ids.every((id) => COMBOS.some((x) => x.id === id && !!x.tag && x.desc.length > 30)));
  check('registry: every new card takes part in a combo', NEW3.every((c) => COMBOS.some((x) => x.first.includes(c) || x.second.includes(c))));
  let overlap = 0;
  for (const a of Object.keys(CARDS) as CardId[])
    for (const b of Object.keys(CARDS) as CardId[]) if (COMBOS.filter((x) => !x.after && x.first.includes(a) && x.second.includes(b)).length > 1) overlap++;
  check('registry: no two combos claim the same pair of cards', overlap === 0);
  check('registry: SUPERSTAR MOVE still OVERDRIVE → signature, MAIN EVENT included', comboFor('overdrive', 'main_event')?.id === 'superstar');
  check('registry: combo damage bonuses stay modest (≤ ×1.25)', COMBO_TUNING.ovationMult <= 1.25 && COMBO_TUNING.closeUpMult <= 1.25);
  // no new «one big sequence»: the strongest single card shot the 1.9.8 content can make stays under the strongest of 1.9.7
  // (only one combo applies to a card: STANDING OVATION / CLOSE-UP / SUPERSTAR MOVE never stack)
  const newMax = Math.max(CARD_TUNING.main_event.damage * Math.max(COMBO_TUNING.ovationMult, COMBO_TUNING.closeUpMult, COMBO_TUNING.superstarMult), CARD_TUNING.power_shot.damage * Math.max(COMBO_TUNING.ovationMult, COMBO_TUNING.closeUpMult));
  const oldMax = Math.max(CARD_TUNING.power_shot.damage, CARD_TUNING.knockout.damage) * COMBO_TUNING.counterStrikeMult;
  check(`registry: no excessive burst — the strongest new card shot ${Math.round(newMax)} ≤ the strongest of 1.9.7 ${Math.round(oldMax)} (KNOCKOUT after DASH); MAIN EVENT is in no COUNTER STRIKE`, newMax <= oldMax && !COMBOS.some((x) => x.id === 'counter_strike' && x.second.includes('main_event')));
}

// ================================================================= ACE
{
  const a = FIGHTERS.ace;
  check('ACE: on the roster after Rina, before the seasonal stars', FIGHTER_ORDER.indexOf('ace') === FIGHTER_ORDER.indexOf('rina') + 1 && FIGHTER_ORDER.slice(-2).join() === 'lucien,crax');
  check('ACE: GOLDEN ACE revolver, STAR TURN passive, deck with MAIN EVENT', a.stats.attack.weapon === 'revolver' && a.passive === 'star_turn' && a.defaultDeck.includes('main_event') && a.defaultDeck.length === 4);
  check('ACE: a career contract (dollars), not seasonal', !!a.contract && contractCost('ace') > 0 && !a.seasonal);
  check('ACE: a valid deck keeps MAIN EVENT; other fighters can never take it', validDeck('ace', a.defaultDeck).join() === a.defaultDeck.join() && validDeck('ray', ['main_event', 'dash', 'shield', 'smoke']).join() === FIGHTERS.ray.defaultDeck.join());
}

// ---------------------------------------------------------- MAIN EVENT
/** ACE (side 0) fires MAIN EVENT at dex 6 m away; `after` runs once the round is in the air. */
function mainEvent(after?: (m: Match) => void, before?: (m: Match) => void) {
  const m = arena('ace');
  place(m, 0, 3, 0, -3);
  before?.(m);
  const r = play(m, 'main_event', 0, 8);
  const e0 = m.hands[0].energy;
  const hp0 = m.fighters[1].hp;
  let fired = false;
  const ev: MatchEvent[] = [];
  for (let i = 0; i < 120; i++) {
    if (!fired) aimAt(m);
    m.step(DT);
    const got = m.drainEvents();
    ev.push(...got);
    if (!fired && got.some((x) => x.type === 'shot' && x.side === 0 && x.kind === 'power')) {
      fired = true;
      after?.(m);
    }
  }
  return { m, r, e0, ev, dmg: hp0 - m.fighters[1].hp, energy: m.hands[0].energy, perfect: ev.filter((x) => x.type === 'perfectTake') };
}
{
  const hit = mainEvent();
  const miss = mainEvent((m) => m.fighters[1].place(4, -3, 0));
  const refund = CARD_TUNING.main_event.energyRefund;
  check(`MAIN EVENT: played for 4 energy (${hit.r ?? 'ok'}, ${(8 - hit.e0).toFixed(1)})`, hit.r === null && Math.abs(8 - hit.e0 - 4) < 1e-9);
  check(`MAIN EVENT: a landed round deals its damage (${Math.round(hit.dmg)}) and PERFECT TAKE fires once`, hit.dmg > CARD_TUNING.main_event.damage * 0.75 && hit.perfect.length === 1);
  check(`MAIN EVENT: PERFECT TAKE pays ${refund} energy back (hit ${hit.energy.toFixed(2)} vs miss ${miss.energy.toFixed(2)})`, Math.abs(hit.energy - miss.energy - refund) < 0.02);
  check('MAIN EVENT: a miss pays nothing back and deals nothing', miss.perfect.length === 0 && miss.dmg === 0);
  const shield = mainEvent(undefined, (m) => play(m, 'shield', 1));
  check(`MAIN EVENT: a raised SHIELD blocks it — no PERFECT TAKE (${Math.round(shield.dmg)} through)`, shield.perfect.length === 0 && shield.ev.some((x) => x.type === 'block' && x.side === 1));
  const dodge = mainEvent((m) => (m.fighters[1].invuln = 0.6));
  check('MAIN EVENT: a DASH (i-frames) dodges it — no PERFECT TAKE', dodge.perfect.length === 0 && dodge.dmg === 0);
  // the cast is a readable wind-up (0,62 s for the player, the AI telegraphs longer)
  const m = arena('ace');
  place(m, 0, 3, 0, -3);
  play(m, 'main_event');
  const w = m.fighters[0].action;
  check(`MAIN EVENT: a wind-up of ${CARD_TUNING.main_event.windup} s (pose → cuff → spotlight → shot)`, w.kind === 'windup' && Math.abs(w.total - CARD_TUNING.main_event.windup) < 1e-9);
  const ai = arena('ray', 'dex');
  place(ai, 0, 3, 0, -3);
  ai.hands[1].hand = ['main_event', 'dash', 'shield'];
  ai.hands[1].energy = 10;
  ai.hands[1].lockout = 0;
  ai.playCard(1, 0);
  const wa = ai.fighters[1].action;
  check(`MAIN EVENT: the AI telegraphs longer (${wa.kind === 'windup' ? wa.total.toFixed(2) : '-'} s ≥ ${CARD_TUNING.main_event.telegraph})`, wa.kind === 'windup' && wa.total >= CARD_TUNING.main_event.telegraph * 0.85);
  // energy loop: ACE fires MAIN EVENT back-to-back on a target that never dodges — energy still runs down
  const loop = arena('ace', 'dex');
  place(loop, 0, 3, 0, -3);
  loop.hands[0].energy = MATCH.maxEnergy;
  let casts = 0;
  for (let i = 0; i < 60 * 20; i++) {
    aimAt(loop);
    const h = loop.hands[0];
    if (loop.fighters[0].action.kind === 'none' && h.energy >= 4) {
      h.hand = ['main_event', 'dash', 'shield'];
      h.lockout = 0;
      if (loop.playCard(0, 0) === null) casts++;
    }
    loop.fighters[1].hp = loop.fighters[1].maxHp; // never KO
    loop.step(DT);
    loop.drainEvents();
  }
  // a full bar plus 20 s of regeneration, every cast costing its net price: that is the most there can be
  const net = CARDS.main_event.cost - refund;
  const ceiling = (MATCH.maxEnergy + MATCH.energyPerSecond * 20) / net;
  check(`MAIN EVENT: no energy loop — every landed one still costs ${net} net (${casts} in 20 s ≤ ${ceiling.toFixed(1)}, all landed)`, casts > 3 && casts <= ceiling + 1e-9);
}

// ------------------------------------------------------------ STAR TURN
{
  const m = arena('ace', 'dex');
  place(m, 0, 2.5, 0, -2.5);
  const p = m.fighters[0];
  const e = m.fighters[1];
  p.wantFire = true;
  const ev = run(m, 4, () => {
    p.wantFire = true;
    e.hp = e.maxHp;
  });
  const hits = hitsOn(ev, 1).filter((x) => x.kind === 'auto');
  const ready = ev.filter((x) => x.type === 'starTurn' && x.what === 'ready').length;
  const fire = ev.filter((x) => x.type === 'starTurn' && x.what === 'fire').length;
  const base = Math.min(...hits.map((x) => x.damage));
  const top = Math.max(...hits.map((x) => x.damage));
  check(`STAR TURN: ${PASSIVE_TUNING.star_turn.every} landed shots ready the star shot (${hits.length} hits, ${ready} ready, ${fire} fired)`, hits.length >= 6 && ready >= 1 && fire >= 1 && fire <= ready);
  check(`STAR TURN: the star shot hits ×${PASSIVE_TUNING.star_turn.mult} (${Math.round(base)} → ${Math.round(top)})`, Math.abs(top / base - PASSIVE_TUNING.star_turn.mult) < 0.05);
  check(`STAR TURN: at most one star shot in every ${PASSIVE_TUNING.star_turn.every + 1} landed (${fire} of ${hits.length})`, fire <= Math.ceil(hits.length / (PASSIVE_TUNING.star_turn.every + 1)));
  // a miss breaks the run
  const b = arena('ace', 'dex');
  place(b, 0, 2.5, 0, -2.5);
  const bp = b.fighters[0];
  const be = b.fighters[1];
  let streakAfterMiss = -1;
  let landed = 0;
  for (let i = 0; i < 60 * 3 && streakAfterMiss < 0; i++) {
    aimAt(b);
    bp.wantFire = true;
    be.hp = be.maxHp;
    if (landed === 2) {
      // make the next shot miss: aim far off
      bp.aimX = bp.cardAimX = 4.5;
      bp.aimZ = bp.cardAimZ = 6;
    }
    b.step(DT);
    for (const x of b.drainEvents()) if (x.type === 'hit' && x.side === 1 && x.kind === 'auto') landed++;
    if (landed === 2 && bp.starStreak === 0 && b.projectiles.length === 0) streakAfterMiss = bp.starStreak;
  }
  check(`STAR TURN: a miss resets the run (${streakAfterMiss}, never ready)`, streakAfterMiss === 0 && !bp.starReady);
}

// ------------------------------------------------------------- SHOWTIME
{
  const m = arena('ray');
  place(m, 0, 3, 0, -3);
  const p = m.fighters[0];
  const sp = p.speedMult();
  const fr = p.fireRateMult();
  const ev0 = (() => {
    play(m, 'showtime');
    return m.drainEvents();
  })();
  check(`SHOWTIME: ${CARD_TUNING.showtime.duration} s tempo (speed ×${(p.speedMult() / sp).toFixed(2)}, fire ×${(p.fireRateMult() / fr).toFixed(2)}), the cue waits ${CARD_TUNING.showtime.window} s`, ev0.some((x) => x.type === 'showtime' && x.what === 'on') && Math.abs(p.speedMult() / sp - CARD_TUNING.showtime.speed) < 1e-9 && Math.abs(p.fireRateMult() / fr - CARD_TUNING.showtime.fireRate) < 1e-9 && p.cue === CARD_TUNING.showtime.window);
  run(m, 0.5);
  play(m, 'power_shot');
  const ev1 = m.drainEvents();
  const w = p.action;
  check(`SHOWTIME: the next card comes out on cue — POWER SHOT wind-up ×${CARD_TUNING.showtime.windupMult} (${w.kind === 'windup' ? w.total.toFixed(3) : '-'} s)`, w.kind === 'windup' && Math.abs(w.total - CARD_TUNING.power_shot.windup * CARD_TUNING.showtime.windupMult) < 1e-9 && ev1.some((x) => x.type === 'showtime' && x.what === 'cue'));
  check('SHOWTIME: the cue is spent once (no second short wind-up)', p.cue === 0);
  run(m, 1.5);
  play(m, 'power_shot');
  const w2 = p.action;
  check('SHOWTIME: the card after that has its normal wind-up', w2.kind === 'windup' && Math.abs(w2.total - CARD_TUNING.power_shot.windup) < 1e-9);
  run(m, CARD_TUNING.showtime.duration + 0.5);
  check('SHOWTIME: the tempo ends on time (speed and fire back to normal)', p.showtime === 0 && Math.abs(p.speedMult() - sp) < 1e-9 && Math.abs(p.fireRateMult() - fr) < 1e-9);
  // a second SHOWTIME only renews; the cue expires unused
  const r = arena('ray');
  place(r, 0, 3, 0, -3);
  play(r, 'showtime');
  run(r, 1);
  play(r, 'showtime');
  check('SHOWTIME: a second one only renews the cue and the tempo (nothing stacks)', r.fighters[0].cue === CARD_TUNING.showtime.window && r.fighters[0].showtime === CARD_TUNING.showtime.duration && Math.abs(r.fighters[0].speedMult() / sp - CARD_TUNING.showtime.speed) < 1e-9);
  run(r, CARD_TUNING.showtime.window + 0.2);
  play(r, 'power_shot');
  const w3 = r.fighters[0].action;
  check('SHOWTIME: an unused cue expires after its window', r.fighters[0].cue === 0 && w3.kind === 'windup' && Math.abs(w3.total - CARD_TUNING.power_shot.windup) < 1e-9);
  check('SHOWTIME: no energy is given or refunded', (() => {
    const z = arena('ray');
    place(z, 0, 3, 0, -3);
    play(z, 'showtime', 0, 5);
    return Math.abs(z.hands[0].energy - 3) < 1e-9;
  })());
}

// ---------------------------------------------------------- MAGNET PULL
{
  const t = CARD_TUNING.magnet_pull;
  const m = arena('ray');
  place(m, 0, 3, 0, -3);
  play(m, 'magnet_pull');
  const ev = run(m, 1.2);
  const d = dist(m);
  check(`MAGNET PULL: an opponent 6 m away slides towards the fighter (${d.toFixed(2)} m, never closer than ${t.stopAt})`, d < 5 && d >= t.stopAt - 0.05 && ev.some((x) => x.type === 'magnet' && x.hit));
  check('MAGNET PULL: no damage, no stun, no knockback', m.fighters[1].hp === m.fighters[1].maxHp && m.fighters[1].stun === 0 && m.fighters[1].knockback === 0);
  const close = arena('ray');
  place(close, 0, 1.4, 0, -1.4);
  play(close, 'magnet_pull');
  run(close, 1);
  check(`MAGNET PULL: at ${(2.8).toFixed(1)} m it never pulls closer than ${t.stopAt} m (${dist(close).toFixed(2)})`, dist(close) >= t.stopAt - 0.05);
  const far = arena('ray');
  place(far, 0, 4.5, 0, -4.5);
  play(far, 'magnet_pull');
  const evf = run(far, 1);
  check(`MAGNET PULL: out of reach (9 m > ${t.range}) nothing moves`, Math.abs(far.fighters[1].z + 4.5) < 0.01 && evf.some((x) => x.type === 'magnet' && !x.hit));
  const dash = arena('ray');
  place(dash, 0, 3, 0, -3);
  dash.fighters[1].invuln = 0.4;
  play(dash, 'magnet_pull');
  const evd = run(dash, 1);
  check('MAGNET PULL: a DASH in the air dodges the pulse', Math.abs(dash.fighters[1].z + 3) < 0.01 && evd.some((x) => x.type === 'dodge' && x.side === 1));
  const sh = arena('ray');
  place(sh, 0, 3, 0, -3);
  play(sh, 'shield', 1);
  play(sh, 'magnet_pull');
  run(sh, 1);
  const pulled = 6 - d;
  const pulledShield = 6 - dist(sh);
  check(`MAGNET PULL: a raised SHIELD keeps about half of it (${pulledShield.toFixed(2)} of ${pulled.toFixed(2)} m)`, pulledShield > 0.2 && pulledShield < pulled * 0.65);
  const heavy = arena('ray', 'tank');
  place(heavy, 0, 3, 0, -3);
  play(heavy, 'magnet_pull');
  run(heavy, 1);
  check(`MAGNET PULL: a heavy fighter slides less (${(6 - dist(heavy)).toFixed(2)} m)`, 6 - dist(heavy) < pulled - 0.3);
  // cover stops the slide (STUDIO cemetery: a fighter behind a tombstone stays behind it)
  const g = arena('ray', 'dex', 'graveyard');
  const c = g.covers.list.find((x) => x.alive)!;
  const gap = c.radius + MATCH.fighterRadius + 0.15;
  // the player north of the piece, the rival right behind it to the south
  const dirN = c.z <= 0 ? 1 : -1;
  place(g, c.x, c.z + dirN * 3.2, c.x, c.z - dirN * gap);
  play(g, 'magnet_pull');
  run(g, 1.2);
  const ez = g.fighters[1].z;
  check(`MAGNET PULL: cover stops the slide (the rival stays on its side of the ${c.kind})`, dirN > 0 ? ez < c.z : ez > c.z);
  const wall = arena('ray');
  place(wall, 0, -6.4, 0, -1);
  play(wall, 'magnet_pull');
  run(wall, 1);
  check('MAGNET PULL: never out of the arena', Math.abs(wall.fighters[1].z) <= 6.61 && Math.abs(wall.fighters[0].z) <= 6.61);
  const boss = arena('vega', 'vale');
  // (the champion's slide is scaled like PULSE PUSH — see cards-check; here only: no crash, no stun)
  place(boss, 0, 3, 0, -3);
  play(boss, 'magnet_pull');
  run(boss, 1);
  check('MAGNET PULL: one pulse, no hold — the rival walks freely right after', boss.fighters[1].stun === 0 && boss.fighters[1].shoveX === 0 && boss.fighters[1].shoveZ === 0);
}

// -------------------------------------------------------------- SAFE CUT
{
  const t = CARD_TUNING.safe_cut;
  const hit = (m: Match, damage: number, heavy: boolean, knockback = 0, stun = 0, kind: 'power' | 'auto' | 'dot' = heavy ? 'power' : 'auto') =>
    m.combat.applyHit(m.fighters[1], m.fighters[0], { damage, kind, heavy, crit: false, electric: false, combo: null, knockback, stun, slowAmount: 0, slowDuration: 0, dx: 0, dz: -1, sure: true, projectile: null });
  const ref = arena('ray');
  place(ref, 0, 3, 0, -3);
  const hp0 = ref.fighters[1].hp;
  hit(ref, 600, true, 1.4, 0.5);
  const full = hp0 - ref.fighters[1].hp;
  const fullStun = ref.fighters[1].stun;
  const fullKb = ref.fighters[1].knockback;
  const m = arena('ray');
  place(m, 0, 3, 0, -3);
  play(m, 'safe_cut', 1);
  const up = m.drainEvents();
  check(`SAFE CUT: ${t.duration} s of «the editor's cut» (event up)`, m.fighters[1].safeCut === t.duration && up.some((x) => x.type === 'safeCut' && x.what === 'up'));
  const h1 = m.fighters[1].hp;
  const out = hit(m, 600, true, 1.4, 0.5);
  const cut = h1 - m.fighters[1].hp;
  const ev = m.drainEvents();
  check(`SAFE CUT: the first heavy hit lands cut to ×${t.heavyMult} (${Math.round(cut)} of ${Math.round(full)}) — never a dodge`, out === 'hit' && Math.abs(cut / full - t.heavyMult) < 0.01 && ev.some((x) => x.type === 'safeCut' && x.what === 'cut'));
  check(`SAFE CUT: its stun is halved (${m.fighters[1].stun.toFixed(2)} of ${fullStun.toFixed(2)}) and the push shorter`, m.fighters[1].stun > 0 && m.fighters[1].stun <= fullStun * t.pushMult + 0.01 && m.fighters[1].knockback < fullKb);
  check('SAFE CUT: it ends after the dangerous hit', m.fighters[1].safeCut === 0 && !m.fighters[1].safeCutHeavy);
  m.fighters[1].stun = 0;
  const h2 = m.fighters[1].hp;
  hit(m, 600, true);
  check('SAFE CUT: the next heavy hit is full again', Math.abs(h2 - m.fighters[1].hp - full) < 1);
  // light hits lose 20 %, SAFE CUT keeps waiting for the dangerous one
  const l = arena('ray');
  place(l, 0, 3, 0, -3);
  const lref = l.fighters[1].hp;
  hit(l, 100, false);
  const light = lref - l.fighters[1].hp;
  play(l, 'safe_cut', 1);
  const l1 = l.fighters[1].hp;
  hit(l, 100, false);
  check(`SAFE CUT: lighter hits lose ${Math.round(t.lightCut * 100)}% (${(l1 - l.fighters[1].hp).toFixed(1)} of ${light.toFixed(1)}) and it stays up`, Math.abs((l1 - l.fighters[1].hp) / light - (1 - t.lightCut)) < 0.01 && l.fighters[1].safeCut > 0 && l.fighters[1].safeCutHeavy);
  const big = l.fighters[1].hp;
  hit(l, 400, false);
  check(`SAFE CUT: ${t.threshold}+ damage counts as dangerous even without a heavy card`, Math.abs(big - l.fighters[1].hp - (400 * (big > 0 ? (light / 100) : 1)) * t.heavyMult) < 1.5 && l.fighters[1].safeCut === 0);
  // ticks are not cut
  const d = arena('ray');
  place(d, 0, 3, 0, -3);
  const dref = d.fighters[1].hp;
  hit(d, 40, false, 0, 0, 'dot');
  const tick = dref - d.fighters[1].hp;
  play(d, 'safe_cut', 1);
  const d1 = d.fighters[1].hp;
  hit(d, 40, false, 0, 0, 'dot');
  check('SAFE CUT: ticking damage is not cut and does not spend it', Math.abs(d1 - d.fighters[1].hp - tick) < 1e-6 && d.fighters[1].safeCutHeavy);
  // SHIELD first
  const s = arena('ray');
  place(s, 0, 3, 0, -3);
  play(s, 'shield', 1);
  play(s, 'safe_cut', 1);
  hit(s, 300, true);
  check('SAFE CUT: a raised SHIELD absorbs first and SAFE CUT is kept for later', s.fighters[1].safeCutHeavy && s.fighters[1].safeCut > 0);
  // it runs out
  const r = arena('ray');
  place(r, 0, 3, 0, -3);
  play(r, 'safe_cut', 1);
  const evr = run(r, t.duration + 0.1);
  check('SAFE CUT: unused, it ends after its time (event end)', r.fighters[1].safeCut === 0 && !r.fighters[1].safeCutHeavy && evr.some((x) => x.type === 'safeCut' && x.what === 'end'));
  // a second SAFE CUT renews, never stacks (no ×0.45 × 0.45)
  const two = arena('ray');
  place(two, 0, 3, 0, -3);
  play(two, 'safe_cut', 1);
  run(two, 0.5);
  play(two, 'safe_cut', 1);
  const t1 = two.fighters[1].hp;
  hit(two, 600, true);
  check('SAFE CUT: a second one only renews (one cut, never stacked)', Math.abs((t1 - two.fighters[1].hp) / full - t.heavyMult) < 0.01);
}

// --------------------------------------------------------------- combos
function combo(first: CardId, second: CardId, fighter: FighterId = 'ray', gap = 3): { m: Match; got: ComboId | null; hinted: boolean; ev: MatchEvent[] } {
  const m = arena(fighter);
  place(m, 0, gap, 0, -gap);
  play(m, first);
  run(m, 0.6);
  const h = m.hands[0];
  h.hand = [second, 'shield', 'smoke'];
  h.energy = 10;
  h.lockout = 0;
  const hinted = !!m.comboHint(0, second);
  m.playCard(0, 0);
  const ev = m.drainEvents();
  const c = ev.find((x) => x.type === 'combo' && x.side === 0);
  return { m, got: c && c.type === 'combo' ? c.combo : null, hinted, ev };
}
{
  const cases: [CardId, CardId, ComboId, FighterId?][] = [
    ['showtime', 'power_shot', 'standing_ovation'],
    ['showtime', 'main_event', 'standing_ovation', 'ace'],
    ['magnet_pull', 'power_shot', 'close_up'],
    ['magnet_pull', 'main_event', 'close_up', 'ace'],
    ['showtime', 'magnet_pull', 'star_pull'],
    ['safe_cut', 'dash', 'clean_exit'],
  ];
  const bad: string[] = [];
  for (const [a, b, id, f] of cases) {
    const r = combo(a, b, f);
    if (r.got !== id || !r.hinted) bad.push(`${a}→${b}: ${r.got}/${r.hinted}`);
  }
  check(`combos: all ${cases.length} pairs trigger in a real fight and are hinted first${bad.length ? ' — ' + bad.join(', ') : ''}`, bad.length === 0);
  // STANDING OVATION: shorter wind-up and +25 %
  const o = combo('showtime', 'power_shot');
  const w = o.m.fighters[0].action;
  const ovHp = o.m.fighters[1].hp;
  run(o.m, 1.2);
  const ovDmg = ovHp - o.m.fighters[1].hp;
  const plain = arena('ray');
  place(plain, 0, 3, 0, -3);
  const pHp = plain.fighters[1].hp;
  play(plain, 'power_shot');
  run(plain, 1.5);
  const plainDmg = pHp - plain.fighters[1].hp;
  check(`combos: STANDING OVATION — on cue (${w.kind === 'windup' ? w.total.toFixed(2) : '-'} s) and ×${COMBO_TUNING.ovationMult} (${Math.round(ovDmg)} vs ${Math.round(plainDmg)})`, w.kind === 'windup' && w.total < CARD_TUNING.power_shot.windup && Math.abs(ovDmg / plainDmg - COMBO_TUNING.ovationMult) < 0.03);
  // STAR PULL: further and harder
  const sp = combo('showtime', 'magnet_pull', 'ray', 3.9);
  run(sp.m, 1.2);
  const spEv = sp.ev.find((x) => x.type === 'magnet');
  check(`combos: STAR PULL reaches ${CARD_TUNING.magnet_pull.range + COMBO_TUNING.starPullRange} m (7,8 m away it still pulls)`, !!spEv && spEv.type === 'magnet' && spEv.hit && dist(sp.m) < 7.8 - 0.5);
  const noStar = arena('ray');
  place(noStar, 0, 3.9, 0, -3.9);
  play(noStar, 'magnet_pull');
  run(noStar, 1);
  check('combos: without SHOWTIME the same 7,8 m is out of reach', Math.abs(dist(noStar) - 7.8) < 0.01);
  // CLOSE-UP: harder
  const cu = combo('magnet_pull', 'power_shot');
  const cuHp = cu.m.fighters[1].hp;
  run(cu.m, 1.5);
  check(`combos: CLOSE-UP — the shot after the pull lands ×${COMBO_TUNING.closeUpMult} (${Math.round(cuHp - cu.m.fighters[1].hp)})`, Math.abs((cuHp - cu.m.fighters[1].hp) / plainDmg - COMBO_TUNING.closeUpMult) < 0.03);
  // CLEAN EXIT: a longer dash
  const ce = combo('safe_cut', 'dash');
  const x0 = ce.m.fighters[0].x;
  const z0 = ce.m.fighters[0].z;
  run(ce.m, 0.6);
  const ceD = Math.hypot(ce.m.fighters[0].x - x0, ce.m.fighters[0].z - z0);
  const pd = arena('ray');
  place(pd, 0, 3, 0, -3);
  const px0 = pd.fighters[0].x;
  const pz0 = pd.fighters[0].z;
  play(pd, 'dash');
  run(pd, 0.6);
  const pdD = Math.hypot(pd.fighters[0].x - px0, pd.fighters[0].z - pz0);
  check(`combos: CLEAN EXIT — a longer dash (${ceD.toFixed(2)} vs ${pdD.toFixed(2)} m)`, ceD > pdD * 1.15);
  check('combos: SHOWTIME → SHOWTIME is no combo', combo('showtime', 'showtime').got === null);
}

// ------------------------------------------------- AI and full fights
function fight(fighter: FighterId, deck: CardId[], rival: RivalId, seed: number, foeDeck?: CardId[], where?: ArenaId) {
  const m = new Match({
    fighter,
    deck,
    rival,
    difficulty: 'pro',
    seed,
    fans: 100,
    arena: where,
    autoPlayer: { behavior: 'tactical', smarts: 1, dodge: 0.6, reaction: 0.35 },
    league: foeDeck ? { foe: { fighter: 'ace', deck: foeDeck, tactic: 'balance' } } : undefined,
  });
  const ev: MatchEvent[] = [];
  let maxE = 0;
  let steps = 0;
  while (m.phase !== 'over' && steps < 60 * (m.duration + 60)) {
    m.step(DT);
    steps++;
    ev.push(...m.drainEvents());
    maxE = Math.max(maxE, m.hands[0].energy, m.hands[1].energy);
  }
  return { m, ev, maxE, steps };
}
{
  const deck: CardId[] = ['showtime', 'magnet_pull', 'safe_cut', 'main_event'];
  const played = new Map<string, number>();
  let maxE = 0;
  let over = 0;
  let maxStun = 0;
  for (let i = 0; i < 12; i++) {
    const r = fight('ace', deck, RIVAL_ORDER[i % RIVAL_ORDER.length], 900 + i * 31, i % 2 ? ['magnet_pull', 'safe_cut', 'showtime', 'main_event'] : undefined);
    if (r.m.phase === 'over') over++;
    maxE = Math.max(maxE, r.maxE);
    for (const x of r.ev) if (x.type === 'card') played.set(`${x.side}:${x.card}`, (played.get(`${x.side}:${x.card}`) ?? 0) + 1);
    for (const f of r.m.fighters) maxStun = Math.max(maxStun, f.stun);
  }
  const count = (s: 0 | 1, c: CardId) => played.get(`${s}:${c}`) ?? 0;
  check(`AI: the auto-player plays all four (${[...deck].map((c) => `${c} ${count(0, c)}`).join(', ')})`, deck.every((c) => count(0, c) > 0));
  check(`AI: the league defender (tactic) plays them too (${['showtime', 'magnet_pull', 'safe_cut', 'main_event'].map((c) => `${c} ${count(1, c as CardId)}`).join(', ')})`, (['showtime', 'magnet_pull', 'safe_cut', 'main_event'] as CardId[]).every((c) => count(1, c) > 0));
  check(`safety: every fight ends; energy never above ${MATCH.maxEnergy} (${maxE.toFixed(2)})`, over === 12 && maxE <= MATCH.maxEnergy + 1e-9);
}

// --------------------------------------------------------- determinism
{
  const sig = (seed: number, where?: ArenaId) => {
    const r = fight('ace', ['showtime', 'magnet_pull', 'safe_cut', 'main_event'], 'dex', seed, ['safe_cut', 'magnet_pull', 'showtime', 'main_event'], where);
    const f = r.m.fighters;
    let h = 0;
    for (const x of r.ev) {
      const s = JSON.stringify(x);
      for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
    }
    return `${r.steps}|${f[0].hp.toFixed(6)}|${f[1].hp.toFixed(6)}|${r.m.result?.outcome}|${r.ev.length}|${h}`;
  };
  const a = sig(4242);
  const b = sig(4242);
  const g1 = sig(5151, 'graveyard');
  const g2 = sig(5151, 'graveyard');
  check(`determinism: the same seed replays the same league fight with the new cards (${a.split('|').slice(0, 4).join(' ')})`, a === b);
  check('determinism: the same on the cemetery (covers + MAGNET PULL)', g1 === g2);
  check('determinism: another seed gives another fight', sig(4243) !== a);
}

// ------------------------------------------------------------- career
{
  const store = new MemSave();
  const career = new CareerSystem(store as unknown as SaveSystem);
  store.data.money = 50000;
  store.data.reputation = 60; // level 2
  check('career: the new cards stay closed at level 2', NEW3.every((c) => !career.cardOpen(c)));
  store.data.reputation = 480; // level 5
  const before = store.data.money;
  check('career: at a higher level they are bought once each for their price', NEW3.every((c) => career.buyCard(c)) && before - store.data.money === NEW3.reduce((s, c) => s + cardPrice(c), 0) && NEW3.every((c) => !career.buyCard(c)));
  career.setDeck('ray', ['showtime', 'magnet_pull', 'safe_cut', 'dash']);
  store.save();
  const re = sanitize(JSON.parse(JSON.stringify(store.data)));
  check('career: bought cards and a deck with them survive a reload', NEW3.every((c) => re.cards.owned.includes(c)) && re.fighters.ray.deck.join() === 'showtime,magnet_pull,safe_cut,dash');
  const hacked = sanitize({ ...JSON.parse(JSON.stringify(store.data)), cards: { owned: ['showtime', 'main_event'] } });
  check('career: MAIN EVENT can never be "owned" as a shop card', hacked.cards.owned.join() === 'showtime');
}

let failed = 0;
for (const [name, pass] of checks) {
  if (!pass) failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}`);
}
console.log(failed ? `\nexpansion: FAILED (${failed} of ${checks.length})` : `\nexpansion: OK (${checks.length} checks)`);
proc.exit(failed ? 1 : 0);
