// Headless checks for Alpha 1.9.9 — CARD EVOLUTION, the combos (npm run combofresh):
//   * COMBO FRESHNESS — the owner's anti-spam rule: the same combo again and again loses its BONUS step by step (1st and
//     2nd full, then 70 % → 45 % → 25 %), heals with time and with other combos, never touches a card's own damage, makes
//     the audience sigh a little, works the same for both sides (the AI plays by it) and is deterministic;
//   * the four new combos (POINT BLANK, FADE OUT, ENCORE, COUNTER CUT) — each triggers in a real fight, does what it says,
//     needs its setup, and stays modest; SHOWTIME's cue survives a card without a wind-up; CLOSE-UP takes CHARGED SHOT;
//   * every combo has a purpose (attack / defense / position / tempo / counter) and the UI says so.
// In-memory fights, no browser, no server (PRIME LEAGUE replays the same engine: `npm run league`).
import { CARD_TUNING, COMBO_FRESH, COMBO_TUNING } from '../src/config/balance';
import { CARDS, COMBOS, COMBO_FRESH_NOTE, COMBO_ROLE_LABEL, comboFor, deckCombos } from '../src/config/cards';
import { FIGHTERS, FIGHTER_ORDER, RIVAL_ORDER } from '../src/config/fighters';
import type { CardId, ComboId, ComboRole, FighterId, RivalId } from '../src/config/types';
import { ComboSystem, boost, toward } from '../src/combat/ComboSystem';
import { Match } from '../src/combat/Match';
import type { MatchEvent } from '../src/combat/types';
import { AUTO } from './bots';
import { fs, proc } from './lib/node';

const checks: [string, boolean][] = [];
const check = (name: string, pass: boolean) => checks.push([name, pass]);
const read = (p: string) => fs.readFileSync(p, 'utf8') as string;
const DT = 1 / 60;
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

/** A fight that has just started, both brains switched off (positions and cards set by the test). */
function arena(fighter: FighterId = 'ray', rival: RivalId = 'dex'): Match {
  const m = new Match({ fighter, deck: FIGHTERS[fighter].defaultDeck, rival, difficulty: 'pro', seed: 77, fans: 0 });
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
function run(m: Match, secs: number): MatchEvent[] {
  const out: MatchEvent[] = [];
  for (let i = 0; i < Math.round(secs / DT); i++) {
    aimAt(m);
    m.step(DT);
    out.push(...m.drainEvents());
  }
  return out;
}
type ComboEv = Extract<MatchEvent, { type: 'combo' }>;
const combosOf = (ev: MatchEvent[], side: 0 | 1 = 0) => ev.filter((x): x is ComboEv => x.type === 'combo' && x.side === side);
/** `first`, a short pause, then `second` (the pair's combo, if any, and its event). */
function pair(m: Match, first: CardId, second: CardId, gap = 0.6): { ev: MatchEvent[]; combo: ComboEv | null } {
  play(m, first);
  const ev = run(m, gap);
  play(m, second);
  const ev2 = m.drainEvents();
  const all = [...ev, ...ev2];
  return { ev: all, combo: combosOf(ev2)[0] ?? null };
}

// ================================================================== the rule
{
  const p = COMBO_FRESH.power;
  check(
    `the rule: 1st and 2nd at full strength, then ${p.slice(2).map((x) => Math.round(x * 100) + '%').join(' → ')} (never 0: a stale combo still triggers)`,
    p[0] === 1 && p[1] === 1 && p.slice(1).every((x, i) => x <= p[i]) && p[2] < 1 && p[p.length - 1] > 0 && p[p.length - 1] <= 0.5,
  );
  check(`it heals: one step per ${COMBO_FRESH.healTime} s without that combo, one step per other combo`, COMBO_FRESH.healTime >= 20 && COMBO_FRESH.healTime <= 45 && COMBO_FRESH.varietyHeal === 1);
  check(`the audience: ×power on the combo's rating, a small sigh from the ${COMBO_FRESH.dullAt + 1}th in a row (${COMBO_FRESH.dullRating})`, COMBO_FRESH.dullAt === 3 && COMBO_FRESH.dullRating < 0 && COMBO_FRESH.dullRating >= -3);
  check('only the bonus fades: a multiplier eases towards ×1, a value towards the card\'s own — never below the card', boost(1.5, 0.4) === 1.2 && boost(1.5, 1) === 1.5 && boost(1, 0.25) === 1 && toward(0.85, 1, 0.45) > 0.85 && toward(1, 0.5, 0.25) === 0.875);
}

// ============================================================ ComboSystem
{
  const cs = new ComboSystem();
  const seq = [0, 2, 4, 6, 8, 10].map((t) => cs.landed(0, 'counter_strike', t));
  check(`the same combo again and again: ${seq.map((x) => Math.round(x * 100)).join(' / ')} % — full twice, then down to the floor`, seq.join() === [1, 1, 0.8, 0.6, 0.4, 0.4].join());
  check('the repeats stop counting at the floor (no lasting penalty to dig out of)', cs.repeats(0, 'counter_strike', 10) === COMBO_FRESH.power.length - 1);
  const alt = new ComboSystem();
  const a: number[] = [];
  for (let i = 0; i < 8; i++) a.push(alt.landed(0, i % 2 ? 'electro_blast' : 'counter_strike', i * 2));
  check(`two combos in turn stay fresh (${a.map((x) => Math.round(x * 100)).join(' ')})`, a.every((x) => x === 1));
  const h = new ComboSystem();
  for (const t of [0, 1, 2, 3]) h.landed(0, 'iron_rush', t);
  const healed = [h.power(0, 'iron_rush', 3 + COMBO_FRESH.healTime), h.power(0, 'iron_rush', 3 + COMBO_FRESH.healTime * 2), h.power(0, 'iron_rush', 3 + COMBO_FRESH.healTime * 3)];
  check(`a pause heals it step by step (${healed.map((x) => Math.round(x * 100)).join(' → ')} %)`, healed[0] === COMBO_FRESH.power[3] && healed[1] === COMBO_FRESH.power[2] && healed[2] === 1);
  const v = new ComboSystem();
  for (const t of [0, 1, 2, 3]) v.landed(0, 'counter_strike', t);
  const before = v.power(0, 'counter_strike', 4);
  v.landed(0, 'phantom_step', 4);
  v.landed(0, 'iron_rush', 5);
  const after = v.power(0, 'counter_strike', 6);
  check(`changing tactics heals it: two other combos lift it from ${Math.round(before * 100)} % to ${Math.round(after * 100)} %`, before === COMBO_FRESH.power[4] && after === COMBO_FRESH.power[2]);
  const sides = new ComboSystem();
  for (const t of [0, 1, 2, 3]) sides.landed(1, 'counter_strike', t);
  check('each side has its own count (the rival\'s spam never weakens the player\'s combo)', sides.power(0, 'counter_strike', 4) === 1 && sides.power(1, 'counter_strike', 4) === COMBO_FRESH.power[4]);
  const r1 = new ComboSystem();
  const r2 = new ComboSystem();
  const ids: ComboId[] = ['counter_strike', 'counter_strike', 'electro_blast', 'counter_strike', 'counter_strike', 'counter_strike', 'iron_rush', 'counter_strike'];
  const o1 = ids.map((id, i) => r1.landed(0, id, i * 3.7));
  const o2 = ids.map((id, i) => r2.landed(0, id, i * 3.7));
  check('deterministic: the same plays at the same match times give the same freshness (client = league server)', o1.join() === o2.join());
}

// ===================================================== the bonus in a real fight
{
  // a plain POWER SHOT (no combo), five times: the card's own damage never fades
  const plain = arena('ray');
  const dmg: number[] = [];
  for (let i = 0; i < 5; i++) {
    place(plain, 0, 3, 0, -3);
    plain.fighters[1].hp = plain.fighters[1].maxHp;
    const hp = plain.fighters[1].hp;
    play(plain, 'power_shot');
    run(plain, 1.6);
    dmg.push(hp - plain.fighters[1].hp);
  }
  check(`a card's own damage never fades: POWER SHOT ×5 without a combo — ${dmg.map((x) => Math.round(x)).join(' / ')}`, dmg[0] > 0 && dmg.every((x) => Math.abs(x - dmg[0]) < 1));
  // DASH → POWER SHOT again and again: COUNTER STRIKE's ×1.5 eases towards ×1
  const m = arena('ray');
  const got: { power: number; repeat: number; ratio: number }[] = [];
  const rating: Extract<MatchEvent, { type: 'rating' }>[] = [];
  const reactions: Extract<MatchEvent, { type: 'reaction' }>[] = [];
  for (let i = 0; i < 5; i++) {
    place(m, 0, 3, 0, -3);
    m.fighters[1].hp = m.fighters[1].maxHp;
    m.fighters[0].hp = m.fighters[0].maxHp;
    const r = pair(m, 'dash', 'power_shot', 0.5);
    place(m, 0, 3, 0, -3);
    const hp = m.fighters[1].hp;
    const ev = run(m, 1.6);
    const all = [...r.ev, ...ev];
    rating.push(...all.filter((x): x is Extract<MatchEvent, { type: 'rating' }> => x.type === 'rating'));
    reactions.push(...all.filter((x): x is Extract<MatchEvent, { type: 'reaction' }> => x.type === 'reaction'));
    got.push({ power: r.combo?.power ?? -1, repeat: r.combo?.repeat ?? -1, ratio: (hp - m.fighters[1].hp) / dmg[0] });
  }
  const want = [1, 1, 0.8, 0.6, 0.4];
  check(
    `COUNTER STRIKE five times in a row lands ×${got.map((g) => g.ratio.toFixed(2)).join(' / ')} (×1.5 → ×1.2): the combo still triggers, only its bonus fades`,
    got.every((g, i) => g.power === want[i] && g.repeat === i && Math.abs(g.ratio - boost(COMBO_TUNING.counterStrikeMult, want[i])) < 0.04),
  );
  const cs = rating.filter((x) => x.label === 'COUNTER STRIKE').map((x) => x.amount);
  check(`the audience: COUNTER STRIKE's show value follows its freshness (${cs.join(' / ')})`, cs.length === 5 && cs[0] === COMBOS.find((c) => c.id === 'counter_strike')!.rating && cs[4] < cs[0] && cs[4] >= 1);
  const dull = rating.filter((x) => x.label === 'ОДНООБРАЗНО');
  check(`…and sighs a little from the 4th in a row («ОДНООБРАЗНО» ×${dull.length}, ${COMBO_FRESH.dullRating} each)`, dull.length === 2 && dull.every((x) => x.amount === Math.round(COMBO_FRESH.dullRating)));
  check('the callout says it is a repeat and how much is left («ПОВТОР · БОНУС 80%»)', reactions.some((x) => x.sub === 'ПОВТОР · БОНУС 80%') && reactions.some((x) => x.sub === 'ПОВТОР · БОНУС 40%'));
  // the right combo at the right moment: a COUNTER STRIKE whose DASH dodged a real attack is a read — no repeat
  const rd = arena('ray');
  const reads: { power: number; repeat: number; read: boolean }[] = [];
  for (let i = 0; i < 5; i++) {
    place(rd, 0, 3, 0, -3);
    rd.fighters[0].hp = rd.fighters[0].maxHp;
    // the rival winds up a POWER SHOT; the DASH answers it (FighterSim.readDash), POWER SHOT punishes
    play(rd, 'power_shot', 1);
    run(rd, 0.3);
    const r = pair(rd, 'dash', 'power_shot', 0.5);
    reads.push({ power: r.combo?.power ?? -1, repeat: r.combo?.repeat ?? -1, read: r.combo?.read ?? false });
    run(rd, 1.6);
  }
  check(
    `answers are not spam: five COUNTER STRIKEs that each dodged the rival's attack all land at ${reads.map((x) => Math.round(x.power * 100)).join(' / ')} % (read, no repeat)`,
    reads.every((x) => x.read && x.power === 1 && x.repeat === 0),
  );
  const ir = arena('bruno');
  const iron: { power: number; read: boolean }[] = [];
  for (let i = 0; i < 4; i++) {
    place(ir, 0, 3, 0, -3);
    play(ir, 'shield');
    run(ir, 0.2);
    const [p, e] = ir.fighters;
    ir.combat.applyHit(p, e, { damage: 120, kind: 'auto', heavy: false, crit: false, electric: false, combo: null, knockback: 0, stun: 0, slowAmount: 0, slowDuration: 0, dx: 0, dz: 1, sure: true, projectile: null });
    play(ir, 'overdrive');
    const ev = combosOf(ir.drainEvents())[0];
    iron.push({ power: ev?.power ?? -1, read: ev?.read ?? false });
    run(ir, 9);
  }
  check(`IRON RUSH after a SHIELD that took a hit is an answer too (${iron.map((x) => (x.read ? 'read' : 'loop') + ' ' + Math.round(x.power * 100) + '%').join(', ')})`, iron.every((x) => x.read && x.power === 1));
  check('the reads are named in one place (Match.comboRead): DASH that saw an attack, SHIELD that took a hit, a cut that took one, a frame that caught one', read('src/combat/Match.ts').includes("if (c.id === 'counter_strike') return f.readDash;") && read('src/combat/Match.ts').includes("if (c.id === 'iron_rush') return f.shieldAbsorbed > 0;"));
  // a different combo in between brings it back
  const v = arena('ray');
  for (let i = 0; i < 3; i++) {
    place(v, 0, 3, 0, -3);
    pair(v, 'dash', 'power_shot', 0.5);
    run(v, 1.6);
  }
  place(v, 0, 3, 0, -3);
  pair(v, 'shield', 'overdrive', 0.4);
  run(v, 1.2);
  place(v, 0, 3, 0, -3);
  pair(v, 'smoke', 'dash', 0.4);
  run(v, 1.2);
  place(v, 0, 3, 0, -3);
  const back = pair(v, 'dash', 'power_shot', 0.5);
  check(`two other combos (IRON RUSH, PHANTOM STEP) and COUNTER STRIKE is back to ${Math.round((back.combo?.power ?? 0) * 100)} %`, back.combo?.combo === 'counter_strike' && back.combo.power === 1);
}

// ===================================================== the four new combos
{
  // POINT BLANK: MAGNET PULL → SPLIT SHOT narrows the fan
  const fan = (m: Match) => {
    const bolts = m.projectiles.filter((p) => p.alive && p.kind === 'split' && p.owner === 0);
    if (bolts.length !== 3) return NaN;
    // angles relative to the first bolt (the fan points at −z here: no wrap through ±π)
    const y0 = Math.atan2(bolts[0].vx, bolts[0].vz);
    const rel = bolts.map((p) => Math.atan2(Math.sin(Math.atan2(p.vx, p.vz) - y0), Math.cos(Math.atan2(p.vx, p.vz) - y0)));
    return Math.max(...rel) - Math.min(...rel);
  };
  const pb = arena('ray');
  place(pb, 0, 2.5, 0, -2.5);
  const r = pair(pb, 'magnet_pull', 'split_shot', 0.5);
  pb.step(DT);
  const narrow = fan(pb);
  const plainSplit = arena('ray');
  place(plainSplit, 0, 2.5, 0, -2.5);
  play(plainSplit, 'split_shot');
  plainSplit.step(DT);
  const wide = fan(plainSplit);
  check(`POINT BLANK (MAGNET PULL → SPLIT SHOT): triggers, the fan narrows ${wide.toFixed(2)} → ${narrow.toFixed(2)} rad`, r.combo?.combo === 'point_blank' && narrow < wide * 0.7 && near(narrow, COMBO_TUNING.pointBlankFan, 0.02));
  // FADE OUT: SMOKE → SAFE CUT in the fighter's own smoke — the cut lasts ×1.5; out of the smoke no combo
  const fo = arena('ray');
  place(fo, 0, 3, 0, -3);
  const f1 = pair(fo, 'smoke', 'safe_cut', 0.4);
  check(`FADE OUT (SMOKE → SAFE CUT): in its own smoke the cut lasts ${fo.fighters[0].safeCut.toFixed(1)} s (×${COMBO_TUNING.fadeOutTime})`, f1.combo?.combo === 'fade_out' && near(fo.fighters[0].safeCut, CARD_TUNING.safe_cut.duration * COMBO_TUNING.fadeOutTime));
  const fo2 = arena('ray');
  place(fo2, 0, 3, 0, -3);
  play(fo2, 'smoke');
  run(fo2, 0.4);
  place(fo2, 5, 3, 0, -3);
  play(fo2, 'safe_cut');
  check('FADE OUT needs the smoke: out of it, a plain SAFE CUT (2 s), no combo', combosOf(fo2.drainEvents()).length === 0 && near(fo2.fighters[0].safeCut, CARD_TUNING.safe_cut.duration));
  // ENCORE: SHOWTIME → DASH gives energy back and keeps the cue for the shot
  const en = arena('ray');
  place(en, 0, 3, 0, -3);
  play(en, 'showtime');
  run(en, 0.4);
  const h = en.hands[0];
  h.hand = ['dash', 'shield', 'smoke'];
  h.energy = 10;
  h.lockout = 0;
  en.playCard(0, 0);
  const encore = combosOf(en.drainEvents())[0];
  const energy = h.energy;
  const cueKept = en.fighters[0].cue > 0;
  run(en, 0.6);
  play(en, 'power_shot');
  const w = en.fighters[0].action;
  check(
    `ENCORE (SHOWTIME → DASH): +${COMBO_TUNING.encoreEnergy} energy (${energy.toFixed(1)} of 10 − 2), the cue waits — the next POWER SHOT is on cue`,
    encore?.combo === 'encore' && near(energy, 10 - CARDS.dash.cost + COMBO_TUNING.encoreEnergy, 1e-6) && cueKept && w.kind === 'windup' && near(w.total, CARD_TUNING.power_shot.windup * CARD_TUNING.showtime.windupMult),
  );
  check('ENCORE is no energy loop: SHOWTIME + DASH cost 4, give 1 back', COMBO_TUNING.encoreEnergy <= 1 && CARDS.showtime.cost + CARDS.dash.cost - COMBO_TUNING.encoreEnergy >= 3);
  // SHOWTIME's cue survives a card without a wind-up (1.9.9 compatibility with the older cards)
  const cue = arena('ray');
  place(cue, 0, 3, 0, -3);
  play(cue, 'showtime');
  run(cue, 0.3);
  play(cue, 'shield');
  run(cue, 0.3);
  play(cue, 'power_shot');
  const cw = cue.fighters[0].action;
  check('SHOWTIME → SHIELD → POWER SHOT: the cue waits through the SHIELD — the shot comes out on cue', cw.kind === 'windup' && near(cw.total, CARD_TUNING.power_shot.windup * CARD_TUNING.showtime.windupMult) && cue.fighters[0].cue === 0);
  // CLOSE-UP takes CHARGED SHOT too (MAGNET PULL with Vega's rail shot)
  const cu = arena('vega');
  place(cu, 0, 3, 0, -3);
  const cuR = pair(cu, 'magnet_pull', 'charged_shot', 0.5);
  check('CLOSE-UP: MAGNET PULL → CHARGED SHOT triggers it too', cuR.combo?.combo === 'close_up' && comboFor('magnet_pull', 'charged_shot')?.id === 'close_up');
  // COUNTER CUT: SAFE CUT took a dangerous hit → the heavy answer hits harder; without the hit no combo
  const cc = arena('ray');
  place(cc, 0, 3, 0, -3);
  play(cc, 'safe_cut');
  run(cc, 0.2);
  const [p, e] = cc.fighters;
  cc.combat.applyHit(p, e, { damage: 420, kind: 'power', heavy: true, crit: false, electric: false, combo: null, knockback: 0, stun: 0, slowAmount: 0, slowDuration: 0, dx: 0, dz: 1, sure: true, projectile: null });
  const saved = p.cutSaved;
  run(cc, 0.4);
  place(cc, 0, 3, 0, -3);
  cc.fighters[1].hp = cc.fighters[1].maxHp;
  const hpC = cc.fighters[1].hp;
  play(cc, 'power_shot');
  const ccEv = combosOf(cc.drainEvents())[0];
  run(cc, 1.6);
  const ccRatio = (hpC - cc.fighters[1].hp) / CARD_TUNING.power_shot.damage;
  check(`COUNTER CUT (SAFE CUT took the blow → POWER SHOT): ×${ccRatio.toFixed(2)}`, saved && ccEv?.combo === 'counter_cut' && Math.abs(ccRatio - COMBO_TUNING.counterCutMult) < 0.04);
  const nc = arena('ray');
  place(nc, 0, 3, 0, -3);
  const ncR = pair(nc, 'safe_cut', 'power_shot', 0.5);
  check('COUNTER CUT needs the softened blow: SAFE CUT → POWER SHOT with nothing taken is no combo', ncR.combo === null && !nc.fighters[0].cutSaved);
  check('COUNTER CUT stays modest (≤ ×1.25) and a new SAFE CUT clears it', COMBO_TUNING.counterCutMult <= 1.25 && read('src/combat/Abilities.ts').includes('f.cutSaved = false;'));
}

// ================================================================= registry
{
  const roles: ComboRole[] = ['attack', 'defense', 'position', 'tempo', 'counter'];
  const per = roles.map((r) => COMBOS.filter((c) => c.role === r).length);
  check(`every combo has a purpose — attack ${per[0]}, defense ${per[1]}, position ${per[2]}, tempo ${per[3]}, counter ${per[4]}`, COMBOS.every((c) => roles.includes(c.role)) && per.every((n) => n >= 3));
  const fresh: [ComboId, ComboRole, CardId, CardId][] = [
    ['point_blank', 'attack', 'magnet_pull', 'split_shot'],
    ['fade_out', 'defense', 'smoke', 'safe_cut'],
    ['encore', 'tempo', 'showtime', 'dash'],
    ['counter_cut', 'counter', 'safe_cut', 'power_shot'],
  ];
  check('the four new combos: one per purpose, each joins a 1.9.8 card (SHOWTIME / MAGNET PULL / SAFE CUT) with an older one', fresh.every(([id, role, a, b]) => COMBOS.some((c) => c.id === id && c.role === role && !!c.tag && c.desc.length > 40) && comboFor(a, b, null)?.id === id));
  let overlap = 0;
  for (const a of Object.keys(CARDS) as CardId[]) for (const b of Object.keys(CARDS) as CardId[]) if (COMBOS.filter((x) => !x.after && x.first.includes(a) && x.second.includes(b)).length > 1) overlap++;
  check('no two combos claim the same pair of cards', overlap === 0);
  check(`no stack of new damage: the strongest 1.9.9 combo shot stays under COUNTER STRIKE's ×${COMBO_TUNING.counterStrikeMult}`, COMBO_TUNING.counterCutMult < COMBO_TUNING.counterStrikeMult);
  check('a deck lists the new combos it can form (prep screen)', deckCombos(['magnet_pull', 'split_shot', 'safe_cut', 'power_shot']).some((c) => c.id === 'point_blank') && deckCombos(['smoke', 'safe_cut', 'showtime', 'dash']).filter((c) => ['fade_out', 'encore'].includes(c.id)).length === 2);
  check('the card texts say what changed (SHOWTIME: the cue waits for a wind-up; CLOSE-UP: CHARGED SHOT)', CARDS.showtime.desc.includes('Карты без подготовки сигнал не тратят') && COMBOS.find((c) => c.id === 'close_up')!.desc.includes('CHARGED SHOT'));
}

// ===================================================== the AI plays by the rule
{
  const ai = read('src/combat/FighterAI.ts');
  check('the AI reads the ribbon: it does not plan a combo that would land below full strength, and a stale one no longer tempts its card choice', ai.includes('if (m.combos.power(this.side, c.id, m.time) < 1) continue;') && ai.includes('m.combos.repeats(this.side, formed.id, m.time) < COMBO_FRESH.dullAt'));
  // the same fights with and without the rule: the AI pilot on a DASH / POWER SHOT / SHOCK deck
  const streaks = (on: boolean) => {
    const saved = COMBO_FRESH.power;
    const savedDull = COMBO_FRESH.dullRating;
    if (!on) {
      (COMBO_FRESH as { power: readonly number[] }).power = [1, 1, 1, 1, 1];
      COMBO_FRESH.dullRating = 0;
    }
    let combos = 0;
    let third = 0;
    let longest = 0;
    let rivalPowers = 0;
    for (const f of FIGHTER_ORDER.slice(0, 6))
      for (let i = 0; i < 3; i++) {
        const m = new Match({ fighter: f, deck: ['dash', 'power_shot', 'shock', f === 'ray' ? 'shield' : FIGHTERS[f].signature], rival: RIVAL_ORDER[i % RIVAL_ORDER.length], difficulty: 'pro', seed: 4100 + i * 61, fans: 0, autoPlayer: AUTO.smart });
        let last = '';
        let run = 0;
        let steps = 0;
        while (m.phase !== 'over' && steps < 60 * (m.duration + 55)) {
          m.step(DT);
          steps++;
          for (const e of m.drainEvents()) {
            if (e.type !== 'combo') continue;
            if (e.side === 1) {
              if (typeof e.power === 'number') rivalPowers++;
              continue;
            }
            combos++;
            run = e.combo === last ? run + 1 : 1;
            last = e.combo;
            if (run >= 3) third++;
            longest = Math.max(longest, run);
          }
        }
      }
    (COMBO_FRESH as { power: readonly number[] }).power = saved;
    COMBO_FRESH.dullRating = savedDull;
    return { combos, share: third / Math.max(1, combos), longest, rivalPowers };
  };
  const off = streaks(false);
  const on = streaks(true);
  check(
    `the AI varies its combos under the rule: 3rd-in-a-row ${Math.round(off.share * 100)} % → ${Math.round(on.share * 100)} %, longest streak ${off.longest} → ${on.longest} (${on.combos} combos)`,
    on.combos > 0 && on.share <= off.share + 0.02 && on.longest <= Math.max(off.longest, 6),
  );
  check('the rival side lands combos under the same rule (its events carry the freshness too)', on.rivalPowers > 0);
}

// ==================================================================== the UI
{
  const hud = read('src/ui/screens/BattleHUD.ts');
  const prep = read('src/ui/screens/PrepScreen.ts');
  const cards = read('src/ui/screens/CardsScreen.ts');
  const css = read('src/styles/main.css');
  check('the battle: a repeated combo\'s ribbon goes pale and shows what is left («COUNTER STRIKE · 80%»)', hud.includes("cardEl.classList.toggle('stale', !!combo && fresh < 1);") && hud.includes('`${combo.name} · ${Math.round(fresh * 100)}%`') && css.includes('.hand-card.combo-ready.stale .combo-ribbon'));
  check('the prep screen names each combo\'s purpose and states the rule; CARDS states it too', prep.includes('COMBO_ROLE_LABEL[c.role]') && prep.includes('COMBO_FRESH_NOTE') && cards.includes('COMBO_FRESH_NOTE') && Object.keys(COMBO_ROLE_LABEL).length === 5);
  check(`the rule in one line: «${COMBO_FRESH_NOTE.slice(0, 70)}…»`, COMBO_FRESH_NOTE.includes('80% → 60% → 40%') && COMBO_FRESH_NOTE.includes(`~${COMBO_FRESH.healTime} с`) && COMBO_FRESH_NOTE.includes('Урон самих карт не меняется'));
}

let failed = 0;
for (const [name, pass] of checks) {
  if (!pass) failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}`);
}
console.log(failed ? `\ncombofresh: FAILED (${failed} of ${checks.length})` : `\ncombofresh: OK (${checks.length} checks)`);
proc.exit(failed ? 1 : 0);
