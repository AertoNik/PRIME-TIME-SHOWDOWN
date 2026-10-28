// PRIME TIME: SHOWDOWN — Alpha 1.8.9: DAILY PRIME STREAK («ЕЖЕДНЕВНЫЙ ЭФИР») on the server.
// Loaded with require() inside every handler; the pure part (days, the streak, the reward, the status) is plain
// JS shared with the Node checks (`npm run daily`), so both run exactly the same rules.
//
//   GET  /api/prime/daily         the account's streak as the SERVER sees it today (verified PRIME ID)
//   POST /api/prime/daily/claim   today's reward: { op, base, session } — nothing else is read from the game
//
// The server alone decides: the game day (Moscow time, its own clock), whether today was claimed, the streak day,
// the free shield for one missed day and the amount (lib/daily_rules.js, generated from src/config/daily.config.ts).
// The dollars are written into the account's CLOUD SAVE by the server itself, in ONE transaction with the streak
// and the claim record: the save the page is in step with (base = its revision) gets money + amount and
// daily = { claims, day }, becomes a new revision (the previous one goes to the history), and the claim keeps
// the revision and hash it produced. Two requests on the same day: one claim (the second sees it, and a unique
// index on (owner, day) stops it even in a race). A repeated request (the reply was lost) is recognised by its op
// and answered again without paying twice. Only the page holding the account's game session may claim.
// The money of a save is still the game's own bookkeeping (lib/validate.js): this only keeps the DAILY reward from
// ever being chosen, repeated or counted by the browser.

const RULES = require('./daily_rules.js');

const DAY_MS = 86400000;
const OP_RE = /^[A-Za-z0-9_-]{8,64}$/;

// ------------------------------------------------------------------ pure rules
/** The game day number of a moment (days since 1970 in Moscow time, UTC+3). */
function gameDay(ms, rules) {
  return Math.floor((ms + (rules || RULES).utcOffsetMinutes * 60000) / DAY_MS);
}

/** The moment a game day starts (00:00 Moscow) in ms since 1970. */
function dayStart(day, rules) {
  return day * DAY_MS - (rules || RULES).utcOffsetMinutes * 60000;
}

/** What the streak's day n pays — the same table as src/config/daily.config.ts dailyReward. */
function rewardFor(n, rules) {
  const r = rules || RULES;
  const day = Math.max(1, Math.floor(n));
  for (const m of r.milestones) if (m.day === day) return { day: day, money: m.money, kind: 'milestone', milestone: day, label: m.title };
  if (day > 100 && day % r.jubileeEvery === 0) return { day: day, money: r.jubileeMoney, kind: 'milestone', milestone: day, label: day + ' ДНЕЙ В ЭФИРЕ!' };
  const pos = (day - 1) % 7;
  return { day: day, money: r.week[pos], kind: pos === 6 ? 'weekly' : 'daily', milestone: 0, label: r.weekLabels[pos] };
}

/** The next milestone after streak day n. */
function nextMilestone(n, rules) {
  const r = rules || RULES;
  for (const m of r.milestones) if (m.day > n) return { day: m.day, title: m.title, short: m.short, money: m.money };
  const day = (Math.floor(n / r.jubileeEvery) + 1) * r.jubileeEvery;
  return { day: day, title: day + ' ДНЕЙ В ЭФИРЕ!', short: day + ' дней', money: r.jubileeMoney };
}

/** An account that never claimed. */
function emptyState() {
  return { streak: 0, best: 0, lastDay: 0, shieldDay: 0, claims: 0, total: 0, achieved: {} };
}

/** May the missed day `missed` be forgiven? (at most one forgiven day in any shieldDays calendar days) */
function shieldReady(st, missed, rules) {
  return !st.shieldDay || missed - st.shieldDay >= (rules || RULES).shieldDays;
}

/**
 * What a claim on game day `today` would do:
 *   { state: 'claimed' }   today's reward was taken already
 *   { state: 'clock' }     the record is ahead of the server's clock (never pays a day «from the future»)
 *   { state: 'ready', streak, shield, reset }   the day of the streak it pays; shield: yesterday is forgiven;
 *                          reset: the streak broke and starts again from day 1 (the record and best stay)
 */
function plan(st, today, rules) {
  if (st.lastDay > today) return { state: 'clock' };
  if (st.lastDay === today) return { state: 'claimed' };
  if (!st.lastDay) return { state: 'ready', streak: 1, shield: false, reset: false };
  const gap = today - st.lastDay;
  if (gap === 1) return { state: 'ready', streak: st.streak + 1, shield: false, reset: false };
  if (gap === 2 && shieldReady(st, today - 1, rules)) return { state: 'ready', streak: st.streak + 1, shield: true, reset: false };
  return { state: 'ready', streak: 1, shield: false, reset: st.streak > 0 };
}

/** The claim of game day `today`: the new state and what was paid — or null (claimed already / clock). */
function apply(st, today, rules) {
  const p = plan(st, today, rules);
  if (p.state !== 'ready') return null;
  const r = rewardFor(p.streak, rules);
  const achieved = {};
  for (const k of Object.keys(st.achieved || {})) achieved[k] = st.achieved[k];
  const first = r.milestone > 0 && !achieved[String(r.milestone)];
  if (first) achieved[String(r.milestone)] = today;
  const next = {
    streak: p.streak,
    best: Math.max(st.best, p.streak),
    lastDay: today,
    shieldDay: p.shield ? today - 1 : st.shieldDay,
    claims: st.claims + 1,
    total: st.total + r.money,
    achieved: achieved,
  };
  return {
    state: next,
    claim: { seq: next.claims, day: today, streakDay: p.streak, money: r.money, kind: r.kind, milestone: r.milestone, label: r.label, shield: p.shield, reset: p.reset, first: first },
  };
}

/** The account's streak as the game shows it on game day `today` (history: the latest claims, newest first). */
function view(st, today, nowMs, history, rules) {
  const r = rules || RULES;
  const p = plan(st, today, r);
  const claimed = p.state === 'claimed';
  const ready = p.state === 'ready';
  // the streak alive right now: claimed today, or today continues it (the day after, or a forgiven miss)
  const current = claimed || (ready && !p.reset) ? st.streak : 0;
  // the day the next reward belongs to (claimed today: tomorrow's, if it is not missed)
  const nextDay = claimed ? st.streak + 1 : ready ? p.streak : st.streak + 1;
  const upcoming = [];
  for (let i = 0; i < r.upcoming; i++) upcoming.push(rewardFor(nextDay + i, r));
  // a miss of the next day the player could miss (tomorrow once today is claimed, today otherwise)
  const missDay = claimed ? today + 1 : today;
  const shieldFree = !st.shieldDay || missDay - st.shieldDay >= r.shieldDays;
  const nm = nextMilestone(current, r);
  return {
    enabled: true,
    today: today,
    now: nowMs,
    nextDayAt: dayStart(today + 1, r),
    streak: current,
    best: st.best,
    claims: st.claims,
    total: st.total,
    claimedToday: claimed,
    canClaim: ready,
    clock: p.state === 'clock',
    willReset: ready && p.reset,
    willShield: ready && p.shield,
    next: rewardFor(nextDay, r),
    upcoming: upcoming,
    milestones: r.milestones.map((m) => ({ day: m.day, money: m.money, title: m.title, short: m.short, reached: !!(st.achieved || {})[String(m.day)], on: (st.achieved || {})[String(m.day)] || 0 })),
    nextMilestone: { day: nm.day, title: nm.title, short: nm.short, money: nm.money, left: Math.max(0, nm.day - current) },
    // shield: ready — a miss of `missDay` would be forgiven; otherwise it is ready again on `readyOn`
    shield: { ready: !(ready && p.shield) && shieldFree, usedOn: st.shieldDay, readyOn: shieldFree ? missDay : st.shieldDay + r.shieldDays, days: r.shieldDays },
    history: history || [],
  };
}

/** JSON with object keys sorted at every level — exactly the game's cloud copy (src/net/cloudSave.ts canonicalJSON). */
function canonicalJSON(v) {
  if (v === null || typeof v !== 'object') {
    const s = JSON.stringify(v);
    return s === undefined ? 'null' : s;
  }
  if (Array.isArray(v)) return '[' + v.map((x) => (x === undefined || typeof x === 'function' ? 'null' : canonicalJSON(x))).join(',') + ']';
  const keys = Object.keys(v)
    .filter((k) => v[k] !== undefined && typeof v[k] !== 'function')
    .sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJSON(v[k])).join(',') + '}';
}

/**
 * The cloud save with the reward in it: money + amount, daily = { claims, day } (the claim the save already
 * holds — the game applies the same change to its own copy and never twice). null: the text is not a save.
 */
function creditSave(text, money, claims, day) {
  let o;
  try {
    o = JSON.parse(text);
  } catch (_) {
    return null;
  }
  if (!o || typeof o !== 'object' || Array.isArray(o) || typeof o.money !== 'number' || !isFinite(o.money)) return null;
  o.money = Math.max(0, o.money) + money;
  o.daily = { claims: claims, day: day };
  return canonicalJSON(o);
}

// ------------------------------------------------------------------ server
function env(k) {
  return String($os.getenv(k) || '').trim();
}

/** PRIME_DAILY=off switches the feature off on this server (the game then shows no gift); on by default. */
function enabled() {
  return env('PRIME_DAILY') !== 'off';
}

/**
 * The server's clock. Tests only: a server started with PRIME_SERVER_ROLE=dev AND PRIME_DAILY_CLOCK_FILE reads
 * «now» (ms) from that file, so the checks can walk through days without touching any real clock. A production or
 * staging server never reads it.
 */
function clockMs() {
  const file = env('PRIME_DAILY_CLOCK_FILE');
  if (file && env('PRIME_SERVER_ROLE') === 'dev') {
    try {
      const v = Number(toString($os.readFile(file)).trim());
      if (isFinite(v) && v > 0) return Math.floor(v);
    } catch (_) {
      /* no file: the real clock */
    }
  }
  return Date.now();
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

function findOne(app, collection, filter, params) {
  try {
    return app.findFirstRecordByFilter(collection, filter, params);
  } catch (_) {
    return null;
  }
}

function stateOf(r) {
  if (!r) return emptyState();
  let achieved = {};
  try {
    const raw = r.get('achieved');
    const a = typeof raw === 'string' ? JSON.parse(raw || '{}') : JSON.parse(toString(raw) || '{}');
    if (a && typeof a === 'object' && !Array.isArray(a)) achieved = a;
  } catch (_) {
    achieved = {};
  }
  return { streak: r.getInt('streak'), best: r.getInt('best'), lastDay: r.getInt('lastDay'), shieldDay: r.getInt('shieldDay'), claims: r.getInt('claims'), total: r.getInt('total'), achieved: achieved };
}

function claimOut(r) {
  return {
    seq: r.getInt('seq'),
    day: r.getInt('day'),
    streakDay: r.getInt('streak'),
    money: r.getInt('money'),
    kind: r.getString('kind'),
    milestone: r.getInt('milestone'),
    label: r.getString('label'),
    shield: r.getBool('shield'),
    reset: r.getBool('reset'),
    first: r.getBool('first'),
  };
}

function historyOf(app, uid, limit) {
  try {
    return app.findRecordsByFilter('daily_claims', 'owner = {:u}', '-seq', limit, 0, { u: uid }).map((r) => ({ day: r.getInt('day'), streakDay: r.getInt('streak'), money: r.getInt('money'), kind: r.getString('kind'), milestone: r.getInt('milestone') }));
  } catch (_) {
    return [];
  }
}

function statusOf(app, uid, st, t) {
  return view(st, gameDay(t), t, historyOf(app, uid, RULES.historyShown));
}

/** GET /api/prime/daily — the account's streak today (a verified PRIME ID; the documents accepted). */
function status(e) {
  if (!enabled()) return fail(e, 404, 'daily_disabled');
  const P = require(`${__hooks}/lib/prime.js`);
  if (!P.requireVerified(e)) return;
  const uid = e.auth.id;
  const t = clockMs();
  return e.json(200, statusOf(e.app, uid, stateOf(findOne(e.app, 'daily_streaks', 'owner = {:u}', { u: uid })), t));
}

/** POST /api/prime/daily/claim — today's reward, written into the cloud save by the server (see the header). */
function claim(e) {
  if (!enabled()) return fail(e, 404, 'daily_disabled');
  const P = require(`${__hooks}/lib/prime.js`);
  const V = require(`${__hooks}/lib/validate.js`);
  const PAY = require(`${__hooks}/lib/payments.js`);
  if (!P.requireVerified(e)) return;
  const b = body(e);
  const uid = e.auth.id;
  const op = typeof b.op === 'string' ? b.op : '';
  const base = b.base;
  if (!OP_RE.test(op)) return fail(e, 400, 'invalid_op');
  if (typeof base !== 'number' || !isFinite(base) || base < 0 || Math.floor(base) !== base) return fail(e, 400, 'invalid_base');
  const t = clockMs();
  const today = gameDay(t);
  let out = null;
  try {
    e.app.runInTransaction((tx) => {
      // a repeat of this very request (its answer was lost): the same claim again, nothing written twice
      const prev = findOne(tx, 'daily_claims', 'owner = {:u} && op = {:o}', { u: uid, o: op });
      if (prev) {
        const sr = findOne(tx, 'daily_streaks', 'owner = {:u}', { u: uid });
        out = [200, { ok: true, duplicate: true, claim: claimOut(prev), revision: prev.getInt('revision'), hash: prev.getString('hash'), status: statusOf(tx, uid, stateOf(sr), t) }];
        return;
      }
      // PRIME CLOUD 2.0: only the page that holds the account's game session
      const lost = P.sessionProblem(tx, uid, b);
      if (lost) {
        out = lost;
        return;
      }
      const sr = findOne(tx, 'daily_streaks', 'owner = {:u}', { u: uid });
      const st = stateOf(sr);
      const a = apply(st, today);
      if (!a) {
        const p = plan(st, today);
        out = [409, { code: p.state === 'clock' ? 'daily_clock' : 'already_claimed', status: statusOf(tx, uid, st, t) }];
        return;
      }
      // the cloud save the page is in step with — the reward goes exactly there
      const cur = findOne(tx, 'saves', 'owner = {:u}', { u: uid });
      if (!cur) {
        out = [409, { code: 'no_cloud_save' }];
        return;
      }
      const info = P.saveInfo(cur);
      if (info.revision !== base) {
        out = [409, { code: 'conflict', revision: info.revision, hash: info.hash, schema: info.schema, updated: info.updated }];
        return;
      }
      const text = creditSave(cur.getString('data'), a.claim.money, a.claim.seq, today);
      const c = text ? V.checkSaveText(text, { paidFighters: PAY.paidFighters(tx, uid) }) : null;
      if (!c || !c.ok) {
        e.app.logger().warn('prime daily: the cloud save could not take the reward — nothing written', 'user', uid, 'problems', c ? c.problems.join('; ').slice(0, 300) : 'not a save');
        out = [409, { code: 'save_unreadable' }];
        return;
      }
      const hash = $security.sha256(text);
      P.archiveRecord(tx, uid, cur, 'daily');
      cur.set('data', text);
      cur.set('schema', c.schema);
      cur.set('revision', info.revision + 1);
      cur.set('hash', hash);
      cur.set('op', op);
      cur.set('reason', 'daily');
      tx.save(cur);
      P.prune(tx, uid);
      const rec = sr || new Record(tx.findCollectionByNameOrId('daily_streaks'));
      if (!sr) rec.set('owner', uid);
      const ns = a.state;
      rec.set('streak', ns.streak);
      rec.set('best', ns.best);
      rec.set('lastDay', ns.lastDay);
      rec.set('shieldDay', ns.shieldDay);
      rec.set('claims', ns.claims);
      rec.set('total', ns.total);
      rec.set('achieved', ns.achieved);
      tx.save(rec);
      const cl = new Record(tx.findCollectionByNameOrId('daily_claims'));
      cl.set('owner', uid);
      cl.set('op', op);
      cl.set('day', a.claim.day);
      cl.set('seq', a.claim.seq);
      cl.set('streak', a.claim.streakDay);
      cl.set('money', a.claim.money);
      cl.set('kind', a.claim.kind);
      cl.set('milestone', a.claim.milestone);
      cl.set('label', a.claim.label);
      cl.set('shield', a.claim.shield);
      cl.set('reset', a.claim.reset);
      cl.set('first', a.claim.first);
      cl.set('revision', info.revision + 1);
      cl.set('hash', hash);
      tx.save(cl);
      out = [200, { ok: true, claim: a.claim, revision: info.revision + 1, hash: hash, status: view(ns, today, t, historyOf(tx, uid, RULES.historyShown)) }];
    });
  } catch (err) {
    // two requests raced past the checks: the unique index on (owner, day) let only one of them write
    const sr = findOne(e.app, 'daily_streaks', 'owner = {:u}', { u: uid });
    const st = stateOf(sr);
    if (st.lastDay === today) return fail(e, 409, 'already_claimed', { status: statusOf(e.app, uid, st, t) });
    e.app.logger().error('prime daily: claim failed — nothing was written', 'user', uid, 'error', String(err).slice(0, 300));
    return fail(e, 500, 'daily_failed');
  }
  return e.json(out[0], out[1]);
}

/** «Мои данные»: the streak and every claim of the account. */
function exportOf(app, uid) {
  const st = stateOf(findOne(app, 'daily_streaks', 'owner = {:u}', { u: uid }));
  let claims = [];
  try {
    claims = app.findRecordsByFilter('daily_claims', 'owner = {:u}', 'seq', 0, 0, { u: uid }).map((r) => ({ day: r.getInt('day'), seq: r.getInt('seq'), streakDay: r.getInt('streak'), money: r.getInt('money'), kind: r.getString('kind'), milestone: r.getInt('milestone'), shield: r.getBool('shield'), reset: r.getBool('reset'), created: r.getString('created') }));
  } catch (_) {
    claims = [];
  }
  return { streak: st.streak, best: st.best, lastDay: st.lastDay, shieldDay: st.shieldDay, claims: claims };
}

module.exports = {
  // pure (the Node checks)
  DAY_MS: DAY_MS,
  gameDay: gameDay,
  dayStart: dayStart,
  rewardFor: rewardFor,
  nextMilestone: nextMilestone,
  emptyState: emptyState,
  shieldReady: shieldReady,
  plan: plan,
  apply: apply,
  view: view,
  canonicalJSON: canonicalJSON,
  creditSave: creditSave,
  // server
  enabled: enabled,
  status: status,
  claim: claim,
  exportOf: exportOf,
};
