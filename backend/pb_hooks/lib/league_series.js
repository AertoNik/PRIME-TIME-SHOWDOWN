// PRIME TIME: SHOWDOWN — Alpha 1.9.0 PRIME LEAGUE: PRIME RUSH and PRIME SQUAD on the DUEL core (lib/league.js).
//
//   PRIME RUSH    one fighter, a run of `rush.length` duels against new opponents; `rush.lives` losses end it. Its own
//                 record and air points; RP only through rush.rpFactor (0 by default — no second RP farm).
//   PRIME SQUAD   three different fighters in a chosen order against three different defenders of ONE opponent,
//                 three sequential duels; 2 of 3 wins the squad. Settled ONCE when decided: one RP result
//                 (× squad.rpFactor), air points and tokens — never three payments for one squad.
//
// Every duel of a series is an ordinary league match (the same proof, the same expiry); the series row only remembers
// the line-up, the opponents and the results. A voided duel (changed rules) is simply played again.

const L = require('./league.js');
const M = require('./league_math.js');

const RULES = L.RULES;
const OP_RE = /^[A-Za-z0-9_-]{8,64}$/;

function stateOf(r) {
  return L.jget(r, 'state', {}) || {};
}

/** POST /api/prime/league/series/start — { kind, lineup: [{ fighter, deck }], op } and the first duel. */
function start(e) {
  if (!L.gate(e)) return;
  const prof = L.joinedProfile(e);
  if (!prof) return;
  const b = L.body(e);
  const uid = e.auth.id;
  const t = L.now();
  const kind = b.kind;
  if (kind !== 'rush' && kind !== 'squad') return L.fail(e, 400, 'invalid_kind');
  if (b.sim !== require('./league_sim.js').SIM_VERSION) return L.fail(e, 409, 'update_required');
  if (!OP_RE.test(typeof b.op === 'string' ? b.op : '')) return L.fail(e, 400, 'invalid_op');
  if (L.findOne(e.app, 'league_matches', 'attacker = {:u} && status = "active"', { u: uid })) return L.fail(e, 409, 'match_active');
  if (L.find(e.app, 'league_series', 'owner = {:u} && status = "active"', '', 1, { u: uid }).length) return L.fail(e, 409, 'series_active');
  const lineup = b.lineup;
  const need = kind === 'squad' ? RULES.squad.size : 1;
  if (!Array.isArray(lineup) || lineup.length !== need) return L.fail(e, 400, 'invalid_lineup');
  const own = L.ownership(e.app, uid);
  const seen = Object.create(null);
  for (const x of lineup) {
    if (!x || typeof x !== 'object' || seen[x.fighter]) return L.fail(e, 400, 'invalid_lineup');
    seen[x.fighter] = true;
    if (!Array.isArray(x.deck)) x.deck = L.attackDeck(e.app, uid, prof, x.fighter);
    const bad = L.deckProblem(own, x.fighter, x.deck);
    if (bad) return L.fail(e, 400, bad);
  }
  // SQUAD: one opponent with three enabled defenders (else three PRIME NETWORK participants)
  let opp = null;
  if (kind === 'squad') {
    const owners = {};
    for (const d of L.find(e.app, 'league_defense', 'enabled = true && owner != {:u}', '-updated', 500, { u: uid })) {
      const o = d.getString('owner');
      (owners[o] = owners[o] || []).push(d);
    }
    const myMmr = prof.getFloat('mmr');
    let best = null;
    for (const o of Object.keys(owners)) {
      if (owners[o].length < RULES.squad.size) continue;
      const p = L.profileOf(e.app, o);
      if (!p || !p.getBool('defenseOn')) continue;
      const gap = Math.abs(p.getFloat('mmr') - myMmr);
      if (gap <= RULES.matchmaking.window[RULES.matchmaking.window.length - 1] && (!best || gap < best.gap)) best = { owner: o, gap: gap, slots: owners[o].slice(0, RULES.squad.size).map((s) => s.getInt('slot')) };
    }
    opp = best ? { kind: 'player', owner: best.owner, slots: best.slots } : { kind: 'system', ids: RULES.system.roster.slice(0, RULES.squad.size).map((s) => s.id) };
  }
  let series = null;
  try {
    e.app.runInTransaction((tx) => {
      const r = new Record(tx.findCollectionByNameOrId('league_series'));
      r.set('owner', uid);
      r.set('kind', kind);
      r.set('status', 'active');
      r.set('season', M.seasonOf(t));
      r.set('state', { lineup: lineup.map((x) => ({ fighter: x.fighter, deck: x.deck.slice() })), opp: opp, round: 0, results: [], wins: 0, losses: 0, draws: 0, faced: [], op: b.op });
      tx.save(r);
      series = r;
    });
  } catch (_) {
    return L.fail(e, 409, 'series_active');
  }
  return next(e, series);
}

/** The next duel of the open series of this kind. */
function nextRoute(e) {
  if (!L.gate(e)) return;
  const prof = L.joinedProfile(e);
  if (!prof) return;
  const kind = L.body(e).kind;
  const s = L.findOne(e.app, 'league_series', 'owner = {:u} && kind = {:k} && status = "active"', { u: e.auth.id, k: kind });
  if (!s) return L.fail(e, 404, 'no_series');
  return next(e, s);
}

function next(e, s) {
  const uid = e.auth.id;
  const t = L.now();
  const prof = L.profileOf(e.app, uid);
  const st = stateOf(s);
  const active = L.findOne(e.app, 'league_matches', 'attacker = {:u} && status = "active"', { u: uid });
  if (active) {
    if (active.getString('series') === s.id) return e.json(200, { series: view(s), match: L.publicMatch(active, true) });
    return L.fail(e, 409, 'match_active');
  }
  const kind = s.getString('kind');
  const round = st.round;
  const who = kind === 'squad' ? st.lineup[round] : st.lineup[0];
  let forced = null;
  if (kind === 'squad') {
    if (st.opp.kind === 'player') {
      const slot = L.findOne(e.app, 'league_defense', 'owner = {:u} && slot = {:s}', { u: st.opp.owner, s: st.opp.slots[round] });
      const dp = L.profileOf(e.app, st.opp.owner);
      if (slot && dp) forced = { kind: 'player', owner: st.opp.owner, prof: dp, slot: slot };
    }
    if (!forced) {
      const ids = st.opp.ids || RULES.system.roster.map((x) => x.id);
      const sys = RULES.system.roster.find((x) => x.id === ids[round % ids.length]) || RULES.system.roster[round];
      forced = { kind: 'system', sys: sys };
    }
  }
  const r = L.createMatch(e.app, uid, prof, { mode: kind, fighter: who.fighter, deck: who.deck, op: s.id + '-' + round + '-' + st.results.length, series: s.id, round: round, forced: forced, exclude: st.faced }, t);
  if (Array.isArray(r)) return e.json(r[0], r[1]);
  return e.json(200, { series: view(s), match: L.publicMatch(r, true) });
}

function view(s) {
  const st = stateOf(s);
  return { id: s.id, kind: s.getString('kind'), status: s.getString('status'), round: st.round, results: st.results, wins: st.wins, losses: st.losses, draws: st.draws, lineup: st.lineup, done: st.done || null };
}

/** Called by league.settle inside its transaction after a series duel was settled. */
function afterDuel(tx, m, out, prof, t) {
  const s = tx.findRecordById('league_series', m.getString('series'));
  if (s.getString('status') !== 'active') return;
  const st = stateOf(s);
  const o = out.outcome;
  st.results.push({ round: m.getInt('round'), outcome: o, match: m.id });
  if (o === 'win') st.wins++;
  else if (o === 'loss') st.losses++;
  else st.draws++;
  if (m.getString('defOwner')) st.faced.push(m.getString('defOwner'));
  const kind = s.getString('kind');
  let over = false;
  let won = false;
  if (kind === 'squad') {
    st.round++;
    const left = RULES.squad.size - st.round;
    if (st.wins >= RULES.squad.toWin) (over = true), (won = true);
    else if (st.wins + left < RULES.squad.toWin) over = true;
    else if (left <= 0) over = true;
  } else {
    st.round++;
    if (st.losses >= RULES.rush.lives) over = true;
    else if (st.round >= RULES.rush.length) (over = true), (won = st.losses < RULES.rush.lives);
  }
  if (over) {
    st.done = finishSeries(tx, s, st, kind, won, prof, t);
    s.set('status', 'done');
  }
  s.set('state', st);
  tx.save(s);
}

/** Pays a finished series once (inside the duel's transaction; the series row is closed in the same one). */
function finishSeries(tx, s, st, kind, won, prof, t) {
  const sameSeason = s.getInt('season') === M.seasonOf(t);
  const res = { won: won, rp: 0, rpAfter: prof.getInt('rp'), tokens: 0, air: 0 };
  if (!sameSeason) return res;
  if (kind === 'squad') {
    const o = won ? 'win' : st.wins === st.losses ? 'draw' : 'loss';
    const p = { rp: prof.getInt('rp'), mmr: prof.getFloat('mmr'), games: prof.getInt('games'), floor: prof.getInt('floor') };
    const opp = st.opp.kind === 'player' ? (L.profileOf(tx, st.opp.owner) || prof).getFloat('mmr') : p.mmr;
    const factor = RULES.squad.rpFactor * (st.opp.kind === 'system' ? RULES.system.rpFactor : 1);
    const ranked = st.opp.kind === 'player' || M.rankIndex(p.rp) < RULES.system.rankedBelow;
    if (ranked && !L.jget(prof, 'challenge', null)) {
      const a = M.applyRp(p.rp, p.floor, M.rpDelta(p, opp, o, factor));
      res.rp = a.rp - p.rp;
      res.rpAfter = a.rp;
      prof.set('rp', a.rp);
      prof.set('floor', a.floor);
      prof.set('peak', Math.max(prof.getInt('peak'), a.rp));
      if (a.challengeReady) prof.set('challenge', { to: M.rankIndex(a.rp) + 1, wins: 0, losses: 0, since: t });
      const md = M.mmrDelta(p, opp, o, 1);
      prof.set('mmr', Math.round((p.mmr + md) * 10) / 10);
      prof.set('games', p.games + 1);
      const k = o === 'win' ? 'wins' : o === 'loss' ? 'losses' : 'draws';
      prof.set(k, prof.getInt(k) + 1);
    }
    res.air = won ? RULES.air.squadWin : RULES.air.loss;
    res.tokens = L.payTokens(tx, prof, 'squad', s.id, won ? RULES.tokens.win * 2 : RULES.tokens.loss, RULES.tokens.attackPerDay, t);
  } else {
    res.air = st.wins * RULES.air.rushWin;
    res.tokens = L.payTokens(tx, prof, 'rush', s.id, st.wins * RULES.tokens.win, RULES.tokens.attackPerDay, t);
    const stats = L.jget(prof, 'stats', {}) || {};
    stats.rushBest = Math.max(stats.rushBest || 0, st.wins);
    prof.set('stats', stats);
  }
  prof.set('air', prof.getInt('air') + res.air);
  tx.save(prof);
  return res;
}

/** A voided duel of a series (changed rules): the round is played again. */
function afterVoid(tx, m, t) {
  /* nothing to undo: the round counter only moves on a settled duel */
}

/** POST /api/prime/league/series/abandon — { kind }: ends the open series as it stands (counts what was played). */
function abandon(e) {
  if (!L.gate(e)) return;
  const prof = L.joinedProfile(e);
  if (!prof) return;
  const uid = e.auth.id;
  const kind = L.body(e).kind;
  const s = L.findOne(e.app, 'league_series', 'owner = {:u} && kind = {:k} && status = "active"', { u: uid, k: kind });
  if (!s) return L.fail(e, 404, 'no_series');
  if (L.findOne(e.app, 'league_matches', 'attacker = {:u} && status = "active" && series = {:s}', { u: uid, s: s.id })) return L.fail(e, 409, 'match_active');
  const t = L.now();
  let done = null;
  e.app.runInTransaction((tx) => {
    const r = tx.findRecordById('league_series', s.id);
    if (r.getString('status') !== 'active') return;
    const st = stateOf(r);
    const p = L.profileOf(tx, uid);
    // SQUAD given up: the rounds not played count as lost (never a free way out of a losing squad)
    if (kind === 'squad' && st.results.length > 0) {
      while (st.round < RULES.squad.size) {
        st.results.push({ round: st.round, outcome: 'loss', match: null });
        st.losses++;
        st.round++;
      }
      st.done = finishSeries(tx, r, st, kind, st.wins >= RULES.squad.toWin, p, t);
    } else if (kind === 'rush') st.done = finishSeries(tx, r, st, kind, false, p, t);
    else st.done = { won: false, rp: 0, tokens: 0, air: 0, cancelled: true };
    r.set('state', st);
    r.set('status', 'done');
    tx.save(r);
    done = r;
  });
  return e.json(200, { series: done ? view(done) : null });
}

module.exports = { start: start, next: nextRoute, abandon: abandon, afterDuel: afterDuel, afterVoid: afterVoid, view: view };
