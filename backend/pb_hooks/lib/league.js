// PRIME TIME: SHOWDOWN — Alpha 1.9.0 PRIME LEAGUE (server). Off unless PRIME_LEAGUE=on.
//
//   GET  /api/prime/league/me                  the participant as the SERVER sees it (or the invitation), defence, report
//   POST /api/prime/league/join                { accept: true, rules } — joins with the current rules version
//   PUT  /api/prime/league/defense             { slots: [{ slot, fighter, deck, tactic, look, enabled }] } (1–5)
//   POST /api/prime/league/defense/toggle      { on } — the defence takes part in NEW matches or not
//   POST /api/prime/league/report/seen         the «while you were off air» report was read
//   POST /api/prime/league/match/start         { mode: duel|challenge, fighter, deck, sim, op } — server seed + snapshot
//   GET  /api/prime/league/match/{id}          the match (resume: snapshot, seed, taps the server holds)
//   POST /api/prime/league/match/{id}/inputs   { inputs } — a checkpoint of the taps (a lost connection loses nothing)
//   POST /api/prime/league/match/{id}/finish   { inputs } — the SERVER replays the fight and settles it once
//   GET  /api/prime/league/board               this season's table of real players (PRIME NETWORK participants never in it)
//   GET  /api/prime/league/history             the participant's recent attacks and defences
//   POST /api/prime/league/track/claim         { tier } — a reached season-track reward, once
//   POST /api/prime/league/upgrade             { fighter, op } — a fighter level for PRIME TOKENS (PRIME_LEAGUE_UPGRADES=on)
//   POST /api/prime/league/series/start        { kind: rush|squad, fighters } — PRIME RUSH / PRIME SQUAD
//   POST /api/prime/league/series/abandon      { kind } — gives up the open series (its played duels stay)
//
// THE PROOF: the game never sends a result. It sends the taps; lib/league_sim.js (the game's own fight code) replays
// them on the server's seed and snapshot and the server settles what IT computed — in one transaction that only an
// active match passes (a second finish, a second tab, the expiry job: exactly one settlement). A match the player
// left is settled by the expiry job from the taps the server holds (the fighter fights on without cards).
// Money of PRIME SHOP, cloud saves, consents, the offer and age rules are never touched here.

const RULES = require('./league_rules.js');
const M = require('./league_math.js');

const OP_RE = /^[A-Za-z0-9_-]{8,64}$/;
const ID_RE = /^[a-z0-9]{15}$/;
const HOUR = 3600000;

function env(k) {
  return String($os.getenv(k) || '').trim();
}
function enabled() {
  return env('PRIME_LEAGUE') === 'on';
}
function tokensOn() {
  return env('PRIME_LEAGUE_TOKENS') === 'on';
}
function upgradesOn() {
  return env('PRIME_LEAGUE_UPGRADES') === 'on';
}

/** The server's clock (tests only: PRIME_SERVER_ROLE=dev + PRIME_LEAGUE_CLOCK_FILE; production never reads a file). */
function now() {
  const file = env('PRIME_LEAGUE_CLOCK_FILE');
  if (file && env('PRIME_SERVER_ROLE') === 'dev') {
    try {
      const v = Number(toString($os.readFile(file)).trim());
      if (isFinite(v) && v > 0) return Math.floor(v);
    } catch (_) {
      /* the real clock */
    }
  }
  return Date.now();
}

let simMod = null;
function SIM() {
  if (!simMod) simMod = require('./league_sim.js');
  return simMod;
}

function body(e) {
  const b = e.requestInfo().body;
  return b && typeof b === 'object' ? b : {};
}
function fail(e, status, code, extra) {
  const out = { code: code };
  if (extra) for (const k of Object.keys(extra)) out[k] = extra[k];
  return e.json(status, out);
}
function findOne(app, c, filter, params) {
  try {
    return app.findFirstRecordByFilter(c, filter, params);
  } catch (_) {
    return null;
  }
}
function find(app, c, filter, sort, limit, params) {
  try {
    return app.findRecordsByFilter(c, filter, sort, limit, 0, params);
  } catch (_) {
    return [];
  }
}
function jget(r, k, def) {
  try {
    const raw = r.get(k);
    if (raw === null || raw === undefined) return def;
    const s = typeof raw === 'string' ? raw : toString(raw);
    if (!s || s === 'null') return def;
    return JSON.parse(s);
  } catch (_) {
    return def;
  }
}
function randomInt32() {
  return parseInt($security.randomStringWithAlphabet(8, '0123456789abcdef'), 16) >>> 0;
}
/** Server-side random in [0, 1) (crypto). */
function rnd() {
  return randomInt32() / 4294967296;
}

// ------------------------------------------------------------------ ownership
/**
 * What the account may field: fighters opened in its PRIME CLOUD save or bought in PRIME SHOP, cards = the six basic
 * + the fighter's signature + the cards its save bought, looks = the fighter's own or a bought skin. Bosses, rivals and
 * NPCs are not fighters of the catalogue and can never appear here.
 */
function ownership(app, uid) {
  const SR = require('./save_rules.js');
  const SH = require('./shop_rules.js');
  let data = null;
  const s = findOne(app, 'saves', 'owner = {:u}', { u: uid });
  if (s) {
    try {
      data = JSON.parse(s.getString('data'));
    } catch (_) {
      data = null;
    }
  }
  let skus = [];
  try {
    skus = require('./payments.js').ownedSkus(app, uid);
  } catch (_) {
    skus = [];
  }
  const fighters = [];
  for (const id of Object.keys(SR.fighters)) {
    const inSave = data && data.fighters && data.fighters[id] && data.fighters[id].unlocked === true;
    const bought = skus.some((k) => SH.catalog[k] && SH.catalog[k].kind === 'fighter' && SH.catalog[k].item === id);
    if (inSave || bought || (SR.fighters[id].starter && id === 'ray')) fighters.push(id);
  }
  const owned = data && data.cards && Array.isArray(data.cards.owned) ? data.cards.owned.filter((c) => SR.shopCards.indexOf(c) >= 0) : [];
  const skins = {};
  for (const k of skus) {
    const it = SH.catalog[k];
    if (it && it.kind === 'skin') skins[it.item] = it.fighter;
  }
  return { fighters: fighters, cards: owned, skins: skins, hasSave: !!data };
}

/** A legal league deck for this fighter and owner: 4 different cards of the six basic + signature + bought. null = fine. */
function deckProblem(own, fighter, deck) {
  const SR = require('./save_rules.js');
  // only the roster of the character menu (league_rules.fighters, from FIGHTER_ORDER): never a career rival, boss or NPC
  if (typeof fighter !== 'string' || RULES.fighters.indexOf(fighter) < 0 || !SR.fighters[fighter]) return 'not_league_fighter';
  if (own.fighters.indexOf(fighter) < 0) return 'fighter_not_owned';
  if (!Array.isArray(deck) || deck.length !== 4) return 'deck_size';
  const allowed = SR.universalCards.concat([SR.fighters[fighter].signature], own.cards);
  const seen = Object.create(null);
  for (const c of deck) {
    if (typeof c !== 'string' || allowed.indexOf(c) < 0) return 'card_not_allowed';
    if (!RULES.cardKind[c]) return 'card_not_allowed';
    if (seen[c]) return 'deck_duplicate';
    seen[c] = true;
  }
  return null;
}

/** Is this saved defender still allowed for its owner (fighter, deck, tactic, look)? null = fine. */
function slotProblem(own, s) {
  const bad = deckProblem(own, s.getString('fighter'), jget(s, 'deck', []));
  if (bad) return bad;
  if (RULES.tactics.indexOf(s.getString('tactic')) < 0) return 'defense_tactic';
  const look = s.getString('look');
  if (look && own.skins[look] !== s.getString('fighter')) return 'defense_look';
  return null;
}

/** The deck a fighter attacks with in the league: the saved league deck, else the career deck in the save, else none. */
function attackDeck(app, uid, prof, fighter) {
  const decks = (prof && jget(prof, 'decks', {})) || {};
  if (Array.isArray(decks[fighter])) return decks[fighter];
  const s = findOne(app, 'saves', 'owner = {:u}', { u: uid });
  try {
    const d = JSON.parse(s.getString('data'));
    const k = d.fighters && d.fighters[fighter] && d.fighters[fighter].deck;
    return Array.isArray(k) ? k : null;
  } catch (_) {
    return null;
  }
}

// ------------------------------------------------------------------- profiles
function profileOf(app, uid) {
  return findOne(app, 'league_profiles', 'owner = {:u}', { u: uid });
}

function nickOf(app, uid) {
  const p = findOne(app, 'profiles', 'user = {:u}', { u: uid });
  return p ? p.getString('nickname') : '';
}

function pv(r) {
  return { rp: r.getInt('rp'), mmr: r.getFloat('mmr'), games: r.getInt('games'), floor: r.getInt('floor') };
}

/** A participant entering a new season: the old one goes to league_history, RP and MMR soft-reset (once). */
function ensureSeason(tx, r, t) {
  const cur = M.seasonOf(t);
  const was = r.getInt('season');
  if (was === cur) return false;
  if (r.getInt('games') > 0 || r.getInt('air') > 0) {
    try {
      const h = new Record(tx.findCollectionByNameOrId('league_history'));
      h.set('owner', r.getString('owner'));
      h.set('season', was);
      h.set('rp', r.getInt('rp'));
      h.set('peak', r.getInt('peak'));
      h.set('rank', M.rankOf(r.getInt('peak')).id);
      for (const k of ['games', 'wins', 'losses', 'draws', 'air']) h.set(k, r.getInt(k));
      tx.save(h);
    } catch (_) {
      /* already archived (unique owner + season) */
    }
  }
  const s = M.softReset(r.getInt('rp'), r.getFloat('mmr'));
  r.set('season', cur);
  r.set('rp', s.rp);
  r.set('floor', s.floor);
  r.set('peak', s.rp);
  r.set('mmr', s.mmr);
  for (const k of ['games', 'wins', 'losses', 'draws', 'air']) r.set(k, 0);
  r.set('challenge', null);
  return true;
}

function seasonInfo(t) {
  const n = M.seasonOf(t);
  const b = M.seasonBounds(n);
  return { number: n, start: b[0], end: b[1], now: t, length: RULES.season.lengthDays };
}

function rankView(rp) {
  const k = M.rankOf(rp);
  return { index: k.index, id: k.id, ru: k.ru, en: k.en, color: k.color, division: k.division, base: k.base, next: k.next, divBase: k.divBase, divNext: k.divNext, progress: k.progress };
}

function levelOf(app, uid, fighter) {
  const r = findOne(app, 'league_upgrades', 'owner = {:u} && fighter = {:f}', { u: uid, f: fighter });
  return r ? r.getInt('level') : 0;
}

// -------------------------------------------------------------------- tokens
/** Adds PRIME TOKENS once per (reason, ref) within today's cap for that reason. Returns the amount paid (0: none). */
function payTokens(tx, prof, reason, ref, amount, capPerDay, t) {
  if (!tokensOn() || amount <= 0) return 0;
  const uid = prof.getString('owner');
  const day = M.dayOf(t);
  if (findOne(tx, 'league_ledger', 'owner = {:u} && reason = {:r} && ref = {:f}', { u: uid, r: reason, f: ref })) return 0;
  let pay = amount;
  if (capPerDay > 0) {
    let today = 0;
    for (const l of find(tx, 'league_ledger', 'owner = {:u} && reason = {:r} && day = {:d}', '', 500, { u: uid, r: reason, d: day })) today += l.getInt('delta');
    pay = Math.max(0, Math.min(amount, capPerDay - today));
  }
  if (pay <= 0) return 0;
  const bal = prof.getInt('tokens') + pay;
  const l = new Record(tx.findCollectionByNameOrId('league_ledger'));
  l.set('owner', uid);
  l.set('delta', pay);
  l.set('reason', reason);
  l.set('ref', ref);
  l.set('balance', bal);
  l.set('day', day);
  tx.save(l);
  prof.set('tokens', bal);
  return pay;
}

/** Air points with an optional daily cap (defence) — counted on the match rows of today. */
function defenseAirToday(tx, uid, t) {
  const start = (M.dayOf(t) * M.DAY_MS) - 3 * HOUR;
  let n = 0;
  for (const r of find(tx, 'league_matches', 'defOwner = {:u} && status = "done" && finished >= {:t} && outcome = "loss"', '', 500, { u: uid, t: start })) n += RULES.air.defenseWin;
  return n;
}

// --------------------------------------------------------------- matchmaking
/** Picks a defender: a real participant's enabled slot close in MMR, else a PRIME NETWORK participant. */
function pickDefender(app, uid, prof, t, exclude) {
  const myMmr = prof.getFloat('mmr');
  const recent = find(app, 'league_matches', 'attacker = {:u} && defKind = "player"', '-started', RULES.matchmaking.recentAvoid, { u: uid }).map((r) => r.getString('defOwner'));
  const since = t - 24 * HOUR;
  const owners = {};
  for (const d of find(app, 'league_defense', 'enabled = true && owner != {:u}', '-updated', 500, { u: uid })) {
    const o = d.getString('owner');
    if (exclude && exclude.indexOf(o) >= 0) continue;
    if (!owners[o]) owners[o] = [];
    owners[o].push(d);
  }
  const cands = [];
  for (const o of Object.keys(owners)) {
    const p = profileOf(app, o);
    if (!p || !p.getBool('defenseOn')) continue;
    // a saved defender is checked AGAIN now (a refunded fighter, a changed save, an old rule): only valid ones defend
    const own = ownership(app, o);
    owners[o] = owners[o].filter((s) => !slotProblem(own, s));
    if (!owners[o].length) continue;
    const pair = app.countRecords('league_matches', $dbx.exp('attacker = {:u} AND defOwner = {:o} AND ranked = 1 AND started >= {:t}', { u: uid, o: o, t: since }));
    if (pair >= RULES.matchmaking.pairPerDay) continue;
    cands.push({ owner: o, prof: p, gap: Math.abs(p.getFloat('mmr') - myMmr), recent: recent.indexOf(o) >= 0 });
  }
  for (const w of RULES.matchmaking.window) {
    let pool = cands.filter((c) => c.gap <= w && !c.recent);
    if (!pool.length) pool = cands.filter((c) => c.gap <= w);
    if (pool.length) {
      const c = pool[Math.floor(rnd() * pool.length)];
      const slots = owners[c.owner];
      return { kind: 'player', owner: c.owner, prof: c.prof, slot: slots[Math.floor(rnd() * slots.length)] };
    }
  }
  const roster = RULES.system.roster;
  return { kind: 'system', sys: roster[Math.floor(rnd() * roster.length)] };
}

// ---------------------------------------------------------------- the match
function publicMatch(r, withInputs) {
  const snap = jget(r, 'snapshot', {});
  const out = {
    id: r.id,
    mode: r.getString('mode'),
    series: r.getString('series') || null,
    round: r.getInt('round'),
    status: r.getString('status'),
    ranked: r.getBool('ranked'),
    season: r.getInt('season'),
    sim: r.getString('sim'),
    seed: r.getInt('seed'),
    arena: r.getString('arena'),
    started: r.getInt('started'),
    expires: r.getInt('expires'),
    attacker: snap.attacker,
    defender: snap.defender,
    hpMult: snap.hpMult,
    dmgMult: snap.dmgMult,
    opponent: snap.opponent,
  };
  if (withInputs) out.inputs = jget(r, 'inputs', []);
  if (out.status !== 'active') {
    out.outcome = r.getString('outcome');
    out.method = r.getString('method');
    out.result = jget(r, 'result', null);
    out.rp = r.getInt('rp');
    out.rpAfter = r.getInt('rpAfter');
    out.tokens = r.getInt('tokens');
    out.air = r.getInt('air');
    out.how = r.getString('how');
  }
  return out;
}

function snapshotOf(m) {
  const s = jget(m, 'snapshot', {});
  return { seed: m.getInt('seed'), arena: m.getString('arena'), attacker: s.attacker, defender: s.defender, hpMult: s.hpMult, dmgMult: s.dmgMult };
}

/** Is `next` the stored taps plus more (never a rewrite of what the server already holds)? */
function extendsPrefix(stored, next) {
  if (next.length < stored.length) return false;
  for (let i = 0; i < stored.length; i++) if (stored[i][0] !== next[i][0] || stored[i][1] !== next[i][1]) return false;
  return true;
}

/**
 * Settles a match from the SERVER's replay `out` — exactly once (only an active match passes). how: finish | expired.
 * Returns the stored match (settled now or before).
 */
function settle(app, matchId, out, how, t) {
  let result = null;
  app.runInTransaction((tx) => {
    const m = tx.findRecordById('league_matches', matchId);
    if (m.getString('status') !== 'active') {
      result = m;
      return;
    }
    const uid = m.getString('attacker');
    const prof = profileOf(tx, uid);
    ensureSeason(tx, prof, t);
    const mode = m.getString('mode');
    const snap = jget(m, 'snapshot', {});
    const ranked = m.getBool('ranked') && m.getInt('season') === M.seasonOf(t);
    const o = out.outcome;
    const p = pv(prof);
    let rp = 0;
    let mmr = 0;
    let rpAfter = p.rp;
    const oppMmr = snap.oppMmr;
    const ceremony = [];
    if (ranked && mode === 'duel') {
      const factor = snap.defKind === 'system' ? RULES.system.rpFactor : 1;
      const d = M.rpDelta(p, oppMmr, o, factor);
      const a = M.applyRp(p.rp, p.floor, d);
      rp = a.rp - p.rp;
      rpAfter = a.rp;
      prof.set('rp', a.rp);
      prof.set('floor', a.floor);
      prof.set('peak', Math.max(prof.getInt('peak'), a.rp));
      if (a.challengeReady && !jget(prof, 'challenge', null)) prof.set('challenge', { to: M.rankIndex(a.rp) + 1, wins: 0, losses: 0, since: t });
      if (a.promoted !== null) ceremony.push({ kind: 'rank', rank: a.promoted });
    }
    if (ranked && mode === 'challenge') {
      const ch = jget(prof, 'challenge', null);
      if (ch) {
        const st = M.challengeStep(ch, o);
        if (st.state === 'passed') {
          const base = RULES.ranks[st.to].base;
          rp = base - p.rp;
          rpAfter = base;
          prof.set('rp', base);
          prof.set('floor', base);
          prof.set('peak', Math.max(prof.getInt('peak'), base));
          prof.set('challenge', null);
          ceremony.push({ kind: 'rank', rank: st.to, challenge: true });
        } else if (st.state === 'failed') {
          const back = Math.max(p.floor, RULES.ranks[st.to].base - RULES.challenge.failDrop);
          rp = back - p.rp;
          rpAfter = back;
          prof.set('rp', back);
          prof.set('challenge', null);
          ceremony.push({ kind: 'challenge_failed', rank: st.to });
        } else prof.set('challenge', { to: st.to, wins: st.wins, losses: st.losses, since: ch.since });
      }
    }
    // (RUSH and SQUAD duels pay nothing on their own: lib/league_series.js settles the series once, at its end)
    if (ranked && (mode === 'duel' || mode === 'challenge')) {
      mmr = M.mmrDelta(p, oppMmr, o, snap.defKind === 'system' ? 0.5 : 1);
      prof.set('mmr', Math.round((p.mmr + mmr) * 10) / 10);
      prof.set('games', p.games + 1);
      prof.set(o === 'win' ? 'wins' : o === 'loss' ? 'losses' : 'draws', prof.getInt(o === 'win' ? 'wins' : o === 'loss' ? 'losses' : 'draws') + 1);
    }
    // air points (season progress) and PRIME TOKENS — every settled league fight of this season
    let air = 0;
    let tokens = 0;
    let challengeTokens = 0;
    if (m.getInt('season') === M.seasonOf(t) && (mode === 'duel' || mode === 'challenge')) {
      air = RULES.air[o];
      if (mode === 'challenge' && ceremony.length && ceremony[0].challenge) air += RULES.air.challengeWin;
      prof.set('air', prof.getInt('air') + air);
      if (ranked) {
        tokens = payTokens(tx, prof, 'attack', m.id, RULES.tokens[o], RULES.tokens.attackPerDay, t);
        // a passed PRIME CHALLENGE is its own one-time milestone: outside the daily cap of ordinary matches, and once per
        // season and rank reached (the ledger's unique key) — a retry, a second tab or a replay never pays it twice
        if (mode === 'challenge' && ceremony.length && ceremony[0].challenge) {
          challengeTokens = payTokens(tx, prof, 'challenge', 's' + m.getInt('season') + ':r' + ceremony[0].rank, RULES.tokens.challengeWin, 0, t);
          tokens += challengeTokens;
        }
      }
    }
    const stats = jget(prof, 'stats', {}) || {};
    const key = o === 'win' ? 'attackW' : o === 'loss' ? 'attackL' : 'attackD';
    stats[key] = (stats[key] || 0) + 1;
    stats.bestRank = Math.max(stats.bestRank || 0, M.rankIndex(prof.getInt('peak')));
    prof.set('stats', stats);
    if (ceremony.length) {
      const seen = jget(prof, 'seen', {}) || {};
      seen.ceremony = ceremony[ceremony.length - 1];
      prof.set('seen', seen);
    }
    tx.save(prof);

    // the defender: its slot's record; a won defence pays its owner (never RP — and a lost one never costs RP)
    let defTokens = 0;
    if (snap.defKind === 'player' && m.getString('defOwner')) {
      const dOwner = m.getString('defOwner');
      const slot = findOne(tx, 'league_defense', 'owner = {:u} && fighter = {:f}', { u: dOwner, f: snap.defender.fighter });
      if (slot) {
        const k = o === 'loss' ? 'wins' : o === 'win' ? 'losses' : 'draws';
        slot.set(k, slot.getInt(k) + 1);
        tx.save(slot);
      }
      const dp = profileOf(tx, dOwner);
      if (dp) {
        ensureSeason(tx, dp, t);
        const ds = jget(dp, 'stats', {}) || {};
        const dk = o === 'loss' ? 'defenseW' : o === 'win' ? 'defenseL' : 'defenseD';
        ds[dk] = (ds[dk] || 0) + 1;
        dp.set('stats', ds);
        if (o === 'loss' && m.getBool('ranked')) {
          // one rewarded defence per attacker and day; at most the daily caps
          const day = M.dayOf(t);
          defTokens = payTokens(tx, dp, 'defense', day + ':' + uid, RULES.tokens.defenseWin, RULES.tokens.defensePerDay, t);
          if (defenseAirToday(tx, dOwner, t) < RULES.air.defensePerDay) dp.set('air', dp.getInt('air') + RULES.air.defenseWin);
        }
        tx.save(dp);
      }
    }

    m.set('status', 'done');
    m.set('outcome', o);
    m.set('method', out.method);
    m.set('result', { hp: out.hp, rating: out.rating, duration: out.duration, steps: out.steps, cardsUsed: out.cardsUsed, combos: out.combos, hash: out.hash, clientHash: typeof out.clientHash === 'number' ? out.clientHash : null, ceremony: ceremony, challengeTokens: challengeTokens });
    m.set('rp', rp);
    m.set('rpAfter', rpAfter);
    m.set('mmr', mmr);
    m.set('tokens', tokens);
    m.set('defTokens', defTokens);
    m.set('air', air);
    m.set('finished', t);
    m.set('how', how);
    tx.save(m);
    if (m.getString('series')) require('./league_series.js').afterDuel(tx, m, out, prof, t);
    result = m;
  });
  return result;
}

/** A match that cannot be judged (the rules of the fight changed on the server since it began): void, nothing paid. */
function voidMatch(app, matchId, why, t) {
  let result = null;
  app.runInTransaction((tx) => {
    const m = tx.findRecordById('league_matches', matchId);
    if (m.getString('status') === 'active') {
      m.set('status', 'void');
      m.set('how', why);
      m.set('finished', t);
      tx.save(m);
      if (m.getString('series')) require('./league_series.js').afterVoid(tx, m, t);
    }
    result = m;
  });
  return result;
}

/** Replays and settles (or voids) one match from these taps. */
function resolve(app, m, inputs, how, t) {
  if (m.getString('sim') !== SIM().SIM_VERSION) return voidMatch(app, m.id, 'rules_changed', t);
  const out = SIM().replayLeague(snapshotOf(m), inputs);
  return settle(app, m.id, out, how, t);
}

/**
 * Creates a match for `uid` (shared by DUEL, CHALLENGE and the series): validates the attacker's fighter and deck,
 * picks the defender (or takes `forced`), fixes the snapshot. Returns [status, body] or the record.
 */
function createMatch(app, uid, prof, o, t) {
  const own = ownership(app, uid);
  const bad = deckProblem(own, o.fighter, o.deck);
  if (bad) return [400, { code: bad }];
  let def = o.forced || pickDefender(app, uid, prof, t, o.exclude || []);
  // a SQUAD opponent's defender that is no longer allowed is replaced by a PRIME NETWORK participant
  if (def.kind === 'player' && o.forced && slotProblem(ownership(app, def.owner), def.slot)) def = { kind: 'system', sys: RULES.system.roster[(o.round || 0) % RULES.system.roster.length] };
  let defSide;
  let opponent;
  let oppMmr;
  let defOwner = '';
  const up = upgradesOn();
  const myRank = M.rankIndex(prof.getInt('rp'));
  const myLevel = up ? Math.min(levelOf(app, uid, o.fighter), M.levelCap(myRank)) : 0;
  let defLevel = 0;
  if (def.kind === 'player') {
    const s = def.slot;
    defOwner = def.owner;
    const dp = def.prof;
    defLevel = up ? Math.min(levelOf(app, def.owner, s.getString('fighter')), M.levelCap(M.rankIndex(dp.getInt('rp')))) : 0;
    if (up && Math.abs(defLevel - myLevel) > RULES.upgrades.maxGap) defLevel = myLevel + (defLevel > myLevel ? RULES.upgrades.maxGap : -RULES.upgrades.maxGap);
    const nick = dp.getString('nick') || nickOf(app, def.owner) || 'PRIME';
    defSide = { fighter: s.getString('fighter'), deck: jget(s, 'deck', []), tactic: s.getString('tactic'), look: s.getString('look') || undefined, name: nick, level: defLevel };
    const rk = rankView(dp.getInt('rp'));
    // the producer's look as it was when the match was made (the bill and the history stay as they were seen)
    opponent = { kind: 'player', name: nick, rank: { ru: rk.ru, en: rk.en, division: rk.division, color: rk.color, index: rk.index }, rp: dp.getInt('rp'), slot: s.getInt('slot'), version: s.getInt('version'), look: require('./producer.js').publicLook(app, def.owner) };
    oppMmr = dp.getFloat('mmr');
  } else {
    const sys = def.sys;
    defSide = { fighter: sys.fighter, deck: sys.deck.slice(), tactic: sys.tactic, name: sys.name, level: myLevel };
    defLevel = myLevel;
    opponent = { kind: 'system', name: sys.name, nameEn: sys.nameEn, id: sys.id };
    oppMmr = prof.getFloat('mmr');
  }
  const ma = M.levelMult(myLevel, up);
  const md = M.levelMult(defLevel, up);
  const mode = o.mode;
  let ranked = true;
  if (def.kind === 'system' && mode !== 'rush' && mode !== 'squad' && myRank >= RULES.system.rankedBelow) ranked = mode === 'challenge';
  if (mode === 'rush') ranked = false;
  const seed = randomInt32();
  const arena = RULES.arenas[Math.floor(rnd() * RULES.arenas.length)];
  const snap = {
    attacker: { fighter: o.fighter, deck: o.deck.slice(), level: myLevel },
    defender: defSide,
    hpMult: [ma.hp, md.hp],
    dmgMult: [ma.dmg, md.dmg],
    defKind: def.kind,
    oppMmr: oppMmr,
    opponent: opponent,
  };
  let rec = null;
  let err = null;
  try {
    app.runInTransaction((tx) => {
      const r = new Record(tx.findCollectionByNameOrId('league_matches'));
      r.set('attacker', uid);
      r.set('defOwner', defOwner);
      r.set('defKind', def.kind);
      r.set('mode', mode);
      r.set('series', o.series || '');
      r.set('round', o.round || 0);
      r.set('season', M.seasonOf(t));
      r.set('sim', SIM().SIM_VERSION);
      r.set('seed', seed);
      r.set('arena', arena);
      r.set('snapshot', snap);
      r.set('status', 'active');
      r.set('ranked', ranked);
      r.set('inputs', []);
      r.set('started', t);
      r.set('expires', t + RULES.match.ttlMinutes * 60000);
      r.set('op', o.op || '');
      tx.save(r);
      rec = r;
    });
  } catch (x) {
    err = String(x);
  }
  if (!rec) {
    const active = findOne(app, 'league_matches', 'attacker = {:u} && status = "active"', { u: uid });
    if (active) return [409, { code: 'match_active', match: publicMatch(active, true) }];
    app.logger().error('prime league: a match could not be created', 'error', String(err).slice(0, 200));
    return [500, { code: 'league_unavailable' }];
  }
  return rec;
}

// --------------------------------------------------------------- the routes
function gate(e) {
  if (!enabled()) {
    fail(e, 404, 'league_off');
    return false;
  }
  const P = require('./prime.js');
  return P.requireVerified(e) && withinBudget(e);
}

/**
 * Each account's own request budget in the league. The per-IP aggregate is the rate-limit rule in the settings
 * (migration 1793300000: players behind one NAT address share it); this one slows down a single flooding account alone.
 * Writes (defence, deck, toggles, rewards) have a smaller budget. The replay itself stays guarded by the per-match
 * lock, «finishing» and the starts per hour — never by this alone. Keyed by the signed-in account, never by the body.
 */
const BUDGET = { all: 90, write: 20, windowMs: 60000 };
/** The checks on a developer's computer send far more than a person (honoured with PRIME_SERVER_ROLE=dev only). */
function budgetScale() {
  if (env('PRIME_SERVER_ROLE') !== 'dev') return 1;
  const v = Number(env('PRIME_LEAGUE_BUDGET_SCALE'));
  return isFinite(v) && v >= 1 ? v : 1;
}
function withinBudget(e) {
  const uid = e.auth && e.auth.id;
  if (!uid) return true;
  const t = Date.now();
  const store = e.app.store();
  const path = String(e.request.url.path || '');
  const write = e.request.method !== 'GET' && !/\/league\/(match|series)\//.test(path);
  const kinds = write ? ['all', 'write'] : ['all'];
  const windows = [];
  for (const k of kinds) {
    const key = 'prime_league_rl_' + k + '_' + uid;
    const raw = String(store.get(key) || '');
    const parts = raw.split(':');
    let start = Number(parts[0]) || 0;
    let n = Number(parts[1]) || 0;
    if (t - start >= BUDGET.windowMs) {
      start = t;
      n = 0;
    }
    if (n >= BUDGET[k] * budgetScale()) {
      const wait = Math.max(1000, BUDGET.windowMs - (t - start));
      e.response.header().set('Retry-After', String(Math.ceil(wait / 1000)));
      fail(e, 429, 'too_many_requests', { wait: wait });
      return false;
    }
    windows.push([key, start, n]);
  }
  for (const w of windows) store.set(w[0], w[1] + ':' + (w[2] + 1));
  return true;
}

function joinedProfile(e) {
  const prof = profileOf(e.app, e.auth.id);
  if (!prof) {
    fail(e, 403, 'league_not_joined', { rules: RULES.version });
    return null;
  }
  if (prof.getInt('rules') < RULES.version) {
    fail(e, 403, 'league_rules_changed', { rules: RULES.version });
    return null;
  }
  return prof;
}

function defenseView(app, uid) {
  const own = ownership(app, uid);
  return find(app, 'league_defense', 'owner = {:u}', 'slot', 5, { u: uid }).map((d) => ({
    problem: slotProblem(own, d),
    slot: d.getInt('slot'),
    fighter: d.getString('fighter'),
    deck: jget(d, 'deck', []),
    tactic: d.getString('tactic'),
    look: d.getString('look') || null,
    enabled: d.getBool('enabled'),
    version: d.getInt('version'),
    wins: d.getInt('wins'),
    losses: d.getInt('losses'),
    draws: d.getInt('draws'),
    level: levelOf(app, uid, d.getString('fighter')),
  }));
}

/** «While you were off air»: confirmed fights against this account's defence since it last looked. */
function reportOf(app, uid, since) {
  const rows = find(app, 'league_matches', 'defOwner = {:u} && status = "done" && finished > {:t}', '-finished', 200, { u: uid, t: since });
  const out = { since: since, matches: rows.length, wins: 0, losses: 0, draws: 0, tokens: 0, byFighter: {}, byTactic: {} };
  for (const r of rows) {
    const snap = jget(r, 'snapshot', {});
    const o = r.getString('outcome');
    const k = o === 'loss' ? 'wins' : o === 'win' ? 'losses' : 'draws';
    out[k]++;
    out.tokens += r.getInt('defTokens');
    const f = snap.defender ? snap.defender.fighter : '?';
    const ta = snap.defender ? snap.defender.tactic : '?';
    if (!out.byFighter[f]) out.byFighter[f] = { wins: 0, losses: 0, draws: 0 };
    out.byFighter[f][k]++;
    if (!out.byTactic[ta]) out.byTactic[ta] = { wins: 0, losses: 0, draws: 0 };
    out.byTactic[ta][k]++;
  }
  return out;
}

function profileView(app, prof, t) {
  const uid = prof.getString('owner');
  const rp = prof.getInt('rp');
  const seen = jget(prof, 'seen', {}) || {};
  const claimed = find(app, 'league_rewards', 'owner = {:u} && season = {:s}', 'tier', 50, { u: uid, s: prof.getInt('season') }).map((r) => r.getInt('tier'));
  const active = findOne(app, 'league_matches', 'attacker = {:u} && status = "active"', { u: uid });
  const series = find(app, 'league_series', 'owner = {:u} && status = "active"', '', 5, { u: uid }).map((s) => ({ id: s.id, kind: s.getString('kind'), state: jget(s, 'state', {}) }));
  const ups = {};
  for (const u of find(app, 'league_upgrades', 'owner = {:u}', '', 20, { u: uid })) ups[u.getString('fighter')] = u.getInt('level');
  const board = app.countRecords('league_profiles', $dbx.exp('season = {:s} AND games > 0 AND rp > {:r}', { s: prof.getInt('season'), r: rp })) + 1;
  return {
    joined: true,
    season: seasonInfo(t),
    rp: rp,
    rank: rankView(rp),
    floor: prof.getInt('floor'),
    peak: prof.getInt('peak'),
    games: prof.getInt('games'),
    wins: prof.getInt('wins'),
    losses: prof.getInt('losses'),
    draws: prof.getInt('draws'),
    air: prof.getInt('air'),
    tokens: prof.getInt('tokens'),
    challenge: jget(prof, 'challenge', null),
    defenseOn: prof.getBool('defenseOn'),
    stats: jget(prof, 'stats', {}) || {},
    place: prof.getInt('games') > 0 ? board : null,
    track: { tiers: M.tiersReached(1e12).map((x) => ({ tier: x.tier, at: x.at, tokens: x.tokens || 0, title: x.title || null, emblem: !!x.emblem })), claimed: claimed },
    upgrades: ups,
    report: reportOf(app, uid, seen.report || prof.getInt('joined')),
    ceremony: seen.ceremony || null,
    active: active ? publicMatch(active, true) : null,
    series: series,
    calibration: Math.max(0, RULES.mmr.calibrationGames - prof.getInt('games')),
    decks: jget(prof, 'decks', {}) || {},
  };
}

function flags() {
  return { league: enabled(), tokens: tokensOn(), upgrades: upgradesOn(), rules: RULES.version, sim: SIM().SIM_VERSION };
}

/** GET /api/prime/league/me */
function me(e) {
  if (!gate(e)) return;
  const t = now();
  const uid = e.auth.id;
  let prof = profileOf(e.app, uid);
  if (!prof) return e.json(200, { joined: false, flags: flags(), season: seasonInfo(t), rules: RULES.version });
  settleOwnExpired(e.app, uid, t);
  if (prof.getInt('season') !== M.seasonOf(t)) {
    e.app.runInTransaction((tx) => {
      const p = profileOf(tx, uid);
      if (ensureSeason(tx, p, t)) tx.save(p);
    });
    prof = profileOf(e.app, uid);
  }
  const v = profileView(e.app, prof, t);
  v.flags = flags();
  v.defense = defenseView(e.app, uid);
  v.rulesAccepted = prof.getInt('rules');
  return e.json(200, v);
}

/** POST /api/prime/league/join — informed joining: the checkbox (never pre-ticked) and the rules version shown. */
function join(e) {
  if (!gate(e)) return;
  const b = body(e);
  if (b.accept !== true || b.rules !== RULES.version) return fail(e, 400, 'rules_not_accepted', { rules: RULES.version });
  const uid = e.auth.id;
  const t = now();
  try {
    e.app.runInTransaction((tx) => {
      let r = profileOf(tx, uid);
      if (r) {
        r.set('rules', RULES.version);
        tx.save(r);
        return;
      }
      r = new Record(tx.findCollectionByNameOrId('league_profiles'));
      r.set('owner', uid);
      r.set('season', M.seasonOf(t));
      r.set('rp', 0);
      r.set('mmr', RULES.mmr.start);
      r.set('floor', 0);
      r.set('peak', 0);
      r.set('defenseOn', true);
      r.set('rules', RULES.version);
      r.set('joined', t);
      r.set('stats', {});
      r.set('seen', { report: t });
      r.set('nick', nickOf(tx, uid).slice(0, 16));
      tx.save(r);
    });
  } catch (x) {
    /* a parallel join won — the profile exists */
  }
  return me(e);
}

/** PUT /api/prime/league/defense — the whole Defense Studio at once (1–5 slots, different fighters). */
function putDefense(e) {
  if (!gate(e)) return;
  const prof = joinedProfile(e);
  if (!prof) return;
  const b = body(e);
  const uid = e.auth.id;
  const slots = b.slots;
  if (!Array.isArray(slots) || slots.length < 1 || slots.length > RULES.defense.slots) return fail(e, 400, 'defense_slots');
  const own = ownership(e.app, uid);
  // maps without a prototype: a forged «__proto__» is just an unknown fighter
  const usedF = Object.create(null);
  const usedS = Object.create(null);
  for (const s of slots) {
    if (!s || typeof s !== 'object') return fail(e, 400, 'defense_slot');
    if (!(s.slot >= 1 && s.slot <= RULES.defense.slots && Math.floor(s.slot) === s.slot) || usedS[s.slot]) return fail(e, 400, 'defense_slot');
    usedS[s.slot] = true;
    if (typeof s.fighter !== 'string' || RULES.fighters.indexOf(s.fighter) < 0) return fail(e, 400, 'not_league_fighter', { slot: s.slot });
    if (usedF[s.fighter]) return fail(e, 400, 'defense_duplicate');
    usedF[s.fighter] = true;
    const bad = deckProblem(own, s.fighter, s.deck);
    if (bad) return fail(e, 400, bad, { slot: s.slot });
    if (RULES.tactics.indexOf(s.tactic) < 0) return fail(e, 400, 'defense_tactic', { slot: s.slot });
    if (s.look !== undefined && s.look !== null && s.look !== '' && own.skins[s.look] !== s.fighter) return fail(e, 400, 'defense_look', { slot: s.slot });
    if (typeof s.enabled !== 'boolean') return fail(e, 400, 'defense_slot');
  }
  e.app.runInTransaction((tx) => {
    const old = find(tx, 'league_defense', 'owner = {:u}', '', 10, { u: uid });
    // free the unique (owner, fighter) of slots that change fighter or go away, before writing the new set
    for (const r of old) {
      const keep = slots.find((s) => s.slot === r.getInt('slot') && s.fighter === r.getString('fighter'));
      if (!keep) tx.delete(r);
    }
    for (const s of slots) {
      let r = findOne(tx, 'league_defense', 'owner = {:u} && slot = {:s}', { u: uid, s: s.slot });
      const deck = s.deck.slice();
      const look = s.look || '';
      if (r && JSON.stringify(jget(r, 'deck', [])) === JSON.stringify(deck) && r.getString('tactic') === s.tactic && r.getString('look') === look && r.getBool('enabled') === s.enabled) continue;
      if (!r) {
        r = new Record(tx.findCollectionByNameOrId('league_defense'));
        r.set('owner', uid);
        r.set('slot', s.slot);
        r.set('fighter', s.fighter);
        r.set('version', 0);
      }
      r.set('deck', deck);
      r.set('tactic', s.tactic);
      r.set('look', look);
      r.set('enabled', s.enabled);
      r.set('version', r.getInt('version') + 1);
      tx.save(r);
    }
  });
  return e.json(200, { ok: true, defense: defenseView(e.app, uid) });
}

/** POST /api/prime/league/defense/toggle — { on }: takes part in NEW matches (started ones finish by their snapshot). */
function toggleDefense(e) {
  if (!gate(e)) return;
  const prof = joinedProfile(e);
  if (!prof) return;
  const b = body(e);
  if (typeof b.on !== 'boolean') return fail(e, 400, 'invalid_on');
  prof.set('defenseOn', b.on);
  e.app.save(prof);
  return e.json(200, { ok: true, defenseOn: b.on });
}

/** POST /api/prime/league/report/seen — { what: report | ceremony | (both) } was shown. */
function reportSeen(e) {
  if (!gate(e)) return;
  const prof = joinedProfile(e);
  if (!prof) return;
  const what = body(e).what;
  const seen = jget(prof, 'seen', {}) || {};
  if (what !== 'ceremony') seen.report = now();
  if (what !== 'report') seen.ceremony = null;
  prof.set('seen', seen);
  e.app.save(prof);
  return e.json(200, { ok: true });
}

/** POST /api/prime/league/match/start */
function start(e) {
  if (!gate(e)) return;
  let prof = joinedProfile(e);
  if (!prof) return;
  const b = body(e);
  const uid = e.auth.id;
  const t = now();
  const mode = b.mode === 'challenge' ? 'challenge' : b.mode === 'duel' || b.mode === undefined ? 'duel' : null;
  if (!mode) return fail(e, 400, 'invalid_mode');
  if (b.sim !== SIM().SIM_VERSION) return fail(e, 409, 'update_required', { sim: SIM().SIM_VERSION });
  const op = typeof b.op === 'string' ? b.op : '';
  if (!OP_RE.test(op)) return fail(e, 400, 'invalid_op');
  settleOwnExpired(e.app, uid, t);
  const again = findOne(e.app, 'league_matches', 'attacker = {:u} && op = {:o}', { u: uid, o: op });
  if (again) return e.json(200, { match: publicMatch(again, true), duplicate: true });
  const active = findOne(e.app, 'league_matches', 'attacker = {:u} && status = "active"', { u: uid });
  if (active) return fail(e, 409, 'match_active', { match: publicMatch(active, true) });
  if (e.app.countRecords('league_matches', $dbx.exp('attacker = {:u} AND started >= {:t}', { u: uid, t: t - HOUR })) >= RULES.match.startsPerHour) return fail(e, 429, 'too_many_matches');
  if (find(e.app, 'league_series', 'owner = {:u} && status = "active" && kind != "challenge"', '', 1, { u: uid }).length) return fail(e, 409, 'series_active');
  if (prof.getInt('season') !== M.seasonOf(t)) {
    e.app.runInTransaction((tx) => {
      const p = profileOf(tx, uid);
      if (ensureSeason(tx, p, t)) tx.save(p);
    });
    prof = profileOf(e.app, uid);
  }
  if (mode === 'challenge' && !jget(prof, 'challenge', null)) return fail(e, 409, 'no_challenge');
  if (mode === 'duel' && jget(prof, 'challenge', null)) return fail(e, 409, 'challenge_open');
  const deck = Array.isArray(b.deck) ? b.deck : attackDeck(e.app, uid, prof, b.fighter);
  const r = createMatch(e.app, uid, prof, { mode: mode, fighter: b.fighter, deck: deck, op: op }, t);
  if (Array.isArray(r)) return e.json(r[0], r[1]);
  return e.json(200, { match: publicMatch(r, true) });
}

function ownMatch(e) {
  const id = e.request.pathValue('id');
  if (!ID_RE.test(id || '')) {
    fail(e, 404, 'match_not_found');
    return null;
  }
  const m = findOne(e.app, 'league_matches', 'id = {:id} && attacker = {:u}', { id: id, u: e.auth.id });
  if (!m) fail(e, 404, 'match_not_found');
  return m;
}

/** GET /api/prime/league/match/{id} */
function getMatch(e) {
  if (!gate(e)) return;
  const m = ownMatch(e);
  if (!m) return;
  return e.json(200, { match: publicMatch(m, true) });
}

/** POST /api/prime/league/match/{id}/inputs — a checkpoint (only extends what the server holds). */
function checkpoint(e) {
  if (!gate(e)) return;
  const m = ownMatch(e);
  if (!m) return;
  if (m.getString('status') !== 'active') return e.json(200, { match: publicMatch(m, false) });
  const inputs = body(e).inputs;
  const bad = SIM().checkInputs(inputs);
  if (bad) return fail(e, 400, 'invalid_inputs', { why: bad });
  if (!extendsPrefix(jget(m, 'inputs', []), inputs)) return fail(e, 409, 'inputs_changed');
  if (now() > m.getInt('expires')) return fail(e, 409, 'match_expired');
  e.app.runInTransaction((tx) => {
    const r = tx.findRecordById('league_matches', m.id);
    if (r.getString('status') !== 'active') return;
    if (!extendsPrefix(jget(r, 'inputs', []), inputs)) return;
    r.set('inputs', inputs);
    tx.save(r);
  });
  return e.json(200, { ok: true, held: inputs.length });
}

/** POST /api/prime/league/match/{id}/finish — the server replays the taps and settles what IT computed. */
function finish(e) {
  if (!gate(e)) return;
  const m = ownMatch(e);
  if (!m) return;
  if (m.getString('status') !== 'active') return e.json(200, { match: publicMatch(m, false), duplicate: true, profile: profileView(e.app, profileOf(e.app, e.auth.id), now()), series: seriesOf(e.app, m) });
  if (now() > m.getInt('expires') + 60000) {
    // too late for this request: the server settles from the taps it holds (as the expiry job would)
    const done = resolve(e.app, m, jget(m, 'inputs', []), 'expired', now());
    return e.json(200, { match: publicMatch(done, false), expired: true, profile: profileView(e.app, profileOf(e.app, e.auth.id), now()), series: seriesOf(e.app, done) });
  }
  const inputs = body(e).inputs;
  const bad = SIM().checkInputs(inputs);
  if (bad) return fail(e, 400, 'invalid_inputs', { why: bad });
  if (!extendsPrefix(jget(m, 'inputs', []), inputs)) return fail(e, 409, 'inputs_changed');
  const t = now();
  if (m.getString('sim') !== SIM().SIM_VERSION) {
    const v = voidMatch(e.app, m.id, 'rules_changed', t);
    return e.json(200, { match: publicMatch(v, false) });
  }
  // one replay of a match at a time: a repeat that arrives while the first is still being replayed waits (no double CPU)
  const busyKey = 'prime_league_replay_' + m.id;
  const store = e.app.store();
  if (store.has(busyKey) && t - (store.get(busyKey) || 0) < 60000) return fail(e, 409, 'finishing', { wait: 1500 });
  store.set(busyKey, t);
  let out;
  try {
    out = SIM().replayLeague(snapshotOf(m), inputs);
  } finally {
    store.remove(busyKey);
  }
  // diagnostics only (never trusted): the game's own fingerprint of the fight it showed — a difference means the game
  // and the server ran different fight code and is logged for the team
  const ch = body(e).hash;
  if (typeof ch === 'number' && isFinite(ch)) {
    out.clientHash = ch >>> 0;
    if (out.clientHash !== out.hash) e.app.logger().warn('prime league: the game and the server replay differ', 'match', m.id, 'sim', m.getString('sim'));
  }
  // a fight cannot end sooner in real time than it lasted (minus a small slack)
  const minMs = out.steps * (1000 / 60) - RULES.match.realTimeSlack * 1000;
  if (out.method !== 'forfeit' && t - m.getInt('started') < minMs) return fail(e, 409, 'too_early', { wait: Math.ceil(minMs - (t - m.getInt('started'))) });
  const done = settle(e.app, m.id, out, 'finish', t);
  return e.json(200, { match: publicMatch(done, false), profile: profileView(e.app, profileOf(e.app, e.auth.id), t), series: seriesOf(e.app, done) });
}

/** The account's own match past its deadline is settled as soon as the account shows up (the cron is the backstop). */
function settleOwnExpired(app, uid, t) {
  const m = findOne(app, 'league_matches', 'attacker = {:u} && status = "active" && expires < {:t}', { u: uid, t: t });
  if (m) resolve(app, m, jget(m, 'inputs', []), 'expired', t);
}

/** The series a settled duel belongs to (its state after this duel), or null. */
function seriesOf(app, m) {
  const id = m && m.getString('series');
  if (!id) return null;
  try {
    return require('./league_series.js').view(app.findRecordById('league_series', id));
  } catch (_) {
    return null;
  }
}

/** PUT /api/prime/league/deck — { fighter, deck }: the attacker's league deck for one fighter (the career deck stays). */
function putDeck(e) {
  if (!gate(e)) return;
  const prof = joinedProfile(e);
  if (!prof) return;
  const b = body(e);
  const bad = deckProblem(ownership(e.app, e.auth.id), b.fighter, b.deck);
  if (bad) return fail(e, 400, bad);
  const decks = jget(prof, 'decks', {}) || {};
  decks[b.fighter] = b.deck.slice();
  prof.set('decks', decks);
  e.app.save(prof);
  return e.json(200, { ok: true, decks: decks });
}

/** Cron: matches past their deadline are settled from the taps the server holds (or voided on changed rules). */
function expire(app) {
  if (!enabled()) return 0;
  const t = now();
  let n = 0;
  for (const m of find(app, 'league_matches', 'status = "active" && expires < {:t}', 'expires', 20, { t: t })) {
    try {
      resolve(app, m, jget(m, 'inputs', []), 'expired', t);
      n++;
    } catch (x) {
      app.logger().error('prime league: an expired match could not be settled', 'match', m.id, 'error', String(x).slice(0, 200));
    }
  }
  return n;
}

/** GET /api/prime/league/board?page= — real players of this season by RP (20 a page). */
function board(e) {
  if (!gate(e)) return;
  const t = now();
  const season = M.seasonOf(t);
  const page = Math.max(0, Math.min(500, Math.floor(Number(e.request.url.query().get('page')) || 0)));
  const rows = [];
  let i = page * 20;
  try {
    const list = e.app.findRecordsByFilter('league_profiles', 'season = {:s} && games > 0', '-rp,updated', 20, page * 20, { s: season });
    // the producers' public looks in one query (three ids each — never an account, email or MMR)
    const looks = require('./producer.js').publicLooks(e.app, list.map((r) => r.getString('owner')));
    for (const r of list) {
      i++;
      const k = M.rankOf(r.getInt('rp'));
      rows.push({ place: i, name: r.getString('nick') || 'PRIME', rp: r.getInt('rp'), rank: { ru: k.ru, en: k.en, division: k.division, color: k.color, index: k.index }, games: r.getInt('games'), wins: r.getInt('wins'), me: r.getString('owner') === e.auth.id, look: looks[r.getString('owner')] || null });
    }
  } catch (_) {
    /* an empty season */
  }
  const total = e.app.countRecords('league_profiles', $dbx.exp('season = {:s} AND games > 0', { s: season }));
  return e.json(200, { season: seasonInfo(t), page: page, total: total, rows: rows });
}

/** GET /api/prime/league/history */
function history(e) {
  if (!gate(e)) return;
  const uid = e.auth.id;
  const attacks = find(e.app, 'league_matches', 'attacker = {:u} && status != "active"', '-started', 20, { u: uid }).map((r) => publicMatch(r, false));
  const defenses = find(e.app, 'league_matches', 'defOwner = {:u} && status = "done"', '-finished', 20, { u: uid }).map((r) => {
    const snap = jget(r, 'snapshot', {});
    return { id: r.id, finished: r.getInt('finished'), outcome: r.getString('outcome') === 'loss' ? 'win' : r.getString('outcome') === 'win' ? 'loss' : 'draw', fighter: snap.defender ? snap.defender.fighter : null, tactic: snap.defender ? snap.defender.tactic : null, attackerFighter: snap.attacker ? snap.attacker.fighter : null, tokens: r.getInt('defTokens') };
  });
  const seasons = find(e.app, 'league_history', 'owner = {:u}', '-season', 20, { u: uid }).map((h) => ({ season: h.getInt('season'), rp: h.getInt('rp'), peak: h.getInt('peak'), rank: h.getString('rank'), games: h.getInt('games'), wins: h.getInt('wins') }));
  return e.json(200, { attacks: attacks, defenses: defenses, seasons: seasons });
}

/** POST /api/prime/league/track/claim — { tier } once per season. */
function claimTier(e) {
  if (!gate(e)) return;
  const prof = joinedProfile(e);
  if (!prof) return;
  const tier = body(e).tier;
  const uid = e.auth.id;
  const t = now();
  if (!(tier >= 1 && tier <= RULES.track.length && Math.floor(tier) === tier)) return fail(e, 400, 'invalid_tier');
  let out = null;
  e.app.runInTransaction((tx) => {
    const p = profileOf(tx, uid);
    ensureSeason(tx, p, t);
    const def = RULES.track[tier - 1];
    if (p.getInt('air') < def.at) {
      out = [409, { code: 'tier_not_reached' }];
      return;
    }
    if (findOne(tx, 'league_rewards', 'owner = {:u} && season = {:s} && tier = {:t}', { u: uid, s: p.getInt('season'), t: tier })) {
      out = [200, { ok: true, duplicate: true }];
      return;
    }
    const r = new Record(tx.findCollectionByNameOrId('league_rewards'));
    r.set('owner', uid);
    r.set('season', p.getInt('season'));
    r.set('tier', tier);
    r.set('reward', def);
    tx.save(r);
    const paid = def.tokens ? payTokens(tx, p, 'track', p.getInt('season') + ':' + tier, def.tokens, 0, t) : 0;
    tx.save(p);
    out = [200, { ok: true, tokens: paid, reward: def }];
  });
  return e.json(out[0], out[1]);
}

/** POST /api/prime/league/upgrade — { fighter, op }: one level for PRIME TOKENS (flag PRIME_LEAGUE_UPGRADES). */
function upgrade(e) {
  if (!gate(e)) return;
  if (!upgradesOn() || !tokensOn()) return fail(e, 404, 'upgrades_off');
  const prof = joinedProfile(e);
  if (!prof) return;
  const b = body(e);
  const uid = e.auth.id;
  const t = now();
  if (!OP_RE.test(typeof b.op === 'string' ? b.op : '')) return fail(e, 400, 'invalid_op');
  const own = ownership(e.app, uid);
  if (own.fighters.indexOf(b.fighter) < 0) return fail(e, 400, 'fighter_not_owned');
  let out = null;
  e.app.runInTransaction((tx) => {
    const p = profileOf(tx, uid);
    if (findOne(tx, 'league_ledger', 'owner = {:u} && reason = "upgrade" && ref = {:r}', { u: uid, r: b.op })) {
      out = [200, { ok: true, duplicate: true, level: levelOf(tx, uid, b.fighter) }];
      return;
    }
    let r = findOne(tx, 'league_upgrades', 'owner = {:u} && fighter = {:f}', { u: uid, f: b.fighter });
    const level = r ? r.getInt('level') : 0;
    if (level >= RULES.upgrades.maxLevel) {
      out = [409, { code: 'max_level' }];
      return;
    }
    const cost = M.upgradeCost(level);
    if (p.getInt('tokens') < cost) {
      out = [409, { code: 'not_enough_tokens', cost: cost }];
      return;
    }
    const bal = p.getInt('tokens') - cost;
    const l = new Record(tx.findCollectionByNameOrId('league_ledger'));
    l.set('owner', uid);
    l.set('delta', -cost);
    l.set('reason', 'upgrade');
    l.set('ref', b.op);
    l.set('balance', bal);
    l.set('day', M.dayOf(t));
    tx.save(l);
    p.set('tokens', bal);
    tx.save(p);
    if (!r) {
      r = new Record(tx.findCollectionByNameOrId('league_upgrades'));
      r.set('owner', uid);
      r.set('fighter', b.fighter);
    }
    r.set('level', level + 1);
    tx.save(r);
    out = [200, { ok: true, level: level + 1, tokens: bal, cost: cost }];
  });
  return e.json(out[0], out[1]);
}

/** For /api/prime/config: what the game may show before signing in. */
function publicConfig() {
  return { on: enabled(), rules: RULES.version, sim: enabled() ? SIM().SIM_VERSION : null };
}

module.exports = {
  RULES: RULES,
  payTokens: payTokens,
  pickDefender: pickDefender,
  rankView: rankView,
  enabled: enabled,
  tokensOn: tokensOn,
  upgradesOn: upgradesOn,
  now: now,
  ownership: ownership,
  deckProblem: deckProblem,
  profileOf: profileOf,
  ensureSeason: ensureSeason,
  createMatch: createMatch,
  publicMatch: publicMatch,
  profileView: profileView,
  joinedProfile: joinedProfile,
  gate: gate,
  settle: settle,
  resolve: resolve,
  extendsPrefix: extendsPrefix,
  me: me,
  join: join,
  putDefense: putDefense,
  putDeck: putDeck,
  attackDeck: attackDeck,
  slotProblem: slotProblem,
  seriesOf: seriesOf,
  toggleDefense: toggleDefense,
  reportSeen: reportSeen,
  start: start,
  getMatch: getMatch,
  checkpoint: checkpoint,
  finish: finish,
  expire: expire,
  board: board,
  history: history,
  claimTier: claimTier,
  upgrade: upgrade,
  publicConfig: publicConfig,
  body: body,
  fail: fail,
  findOne: findOne,
  find: find,
  jget: jget,
};
