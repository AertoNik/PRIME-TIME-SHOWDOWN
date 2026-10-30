// PRIME TIME: SHOWDOWN — Alpha 1.9.0 PRIME PRODUCER AVATARS (server). A PRIME ID's producer persona: avatar, frame and
// backdrop — cosmetic only (never a fight, RP, token, order or right).
//
//   GET  /api/prime/producer   the signed-in account's look { avatar, frame, backdrop, rev, chosen }
//   POST /api/prime/producer   { avatar, frame, backdrop, rev } — only ids of producer_rules.js with access «free»;
//                              `rev` must be the revision the page saw (else 409 look_changed with the current look);
//                              at most `limit.changes` writes per `limit.windowMinutes` per account
//
// Public views (league table, opponent cards) read lookOf() — the three ids only.

const RULES = require('./producer_rules.js');

const ID_RE = /^[a-z0-9_]{1,32}$/;

function findOne(app, filter, params) {
  try {
    return app.findFirstRecordByFilter('producer_looks', filter, params);
  } catch (_) {
    return null;
  }
}

/** The same stable default the game computes (src/config/producer.config.ts defaultLook). */
function defaultLook(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  const free = RULES.avatars.filter((a) => a.access === 'free');
  return { avatar: free[h % free.length].id, frame: 'studio', backdrop: RULES.backdrops[(h >>> 8) % RULES.backdrops.length].id };
}

function allowed(list, id) {
  return typeof id === 'string' && ID_RE.test(id) && list.some((x) => x.id === id && x.access === 'free');
}

/** The account's look for every view (a removed or no longer free id falls back to the default — never an empty face). */
function lookOf(app, uid) {
  const r = findOne(app, 'owner = {:u}', { u: uid });
  const d = defaultLook(uid);
  if (!r) return { avatar: d.avatar, frame: d.frame, backdrop: d.backdrop, rev: 0, chosen: false };
  return {
    avatar: allowed(RULES.avatars, r.getString('avatar')) ? r.getString('avatar') : d.avatar,
    frame: allowed(RULES.frames, r.getString('frame')) ? r.getString('frame') : d.frame,
    backdrop: allowed(RULES.backdrops, r.getString('backdrop')) ? r.getString('backdrop') : d.backdrop,
    rev: r.getInt('rev'),
    chosen: true,
  };
}

/** Public: only the three ids (no account, no revision). */
function publicLook(app, uid) {
  const l = lookOf(app, uid);
  return { avatar: l.avatar, frame: l.frame, backdrop: l.backdrop };
}

/** Public looks of several accounts at once (the league table: one query, not one per row). */
function publicLooks(app, uids) {
  const out = {};
  const ids = uids.filter((u) => /^[a-z0-9]{15}$/.test(u)).slice(0, 100);
  if (ids.length) {
    const params = {};
    const filter = ids.map((u, i) => ((params['u' + i] = u), 'owner = {:u' + i + '}')).join(' || ');
    let rows = [];
    try {
      rows = app.findRecordsByFilter('producer_looks', filter, '', ids.length, 0, params);
    } catch (_) {
      rows = [];
    }
    const by = {};
    for (const r of rows) by[r.getString('owner')] = r;
    for (const u of ids) {
      const d = defaultLook(u);
      const r = by[u];
      out[u] = r
        ? { avatar: allowed(RULES.avatars, r.getString('avatar')) ? r.getString('avatar') : d.avatar, frame: allowed(RULES.frames, r.getString('frame')) ? r.getString('frame') : d.frame, backdrop: allowed(RULES.backdrops, r.getString('backdrop')) ? r.getString('backdrop') : d.backdrop }
        : d;
    }
  }
  return out;
}

function get(e) {
  return e.json(200, { look: lookOf(e.app, e.auth.id), catalog: RULES.version });
}

function put(e) {
  const P = require(`${__hooks}/lib/prime.js`);
  if (!P.requireVerified(e)) return;
  const b = e.requestInfo().body || {};
  const uid = e.auth.id;
  if (!allowed(RULES.avatars, b.avatar) || !allowed(RULES.frames, b.frame) || !allowed(RULES.backdrops, b.backdrop)) return e.json(400, { code: 'look_not_allowed' });
  if (typeof b.rev !== 'number' || !isFinite(b.rev) || b.rev < 0 || Math.floor(b.rev) !== b.rev) return e.json(400, { code: 'invalid_rev' });
  const now = Date.now();
  const win = RULES.limit.windowMinutes * 60000;
  let out = null;
  try {
    e.app.runInTransaction((tx) => {
      let r = findOne(tx, 'owner = {:u}', { u: uid });
      const rev = r ? r.getInt('rev') : 0;
      if (b.rev !== rev) {
        out = [409, { code: 'look_changed', look: lookOf(tx, uid) }];
        return;
      }
      const inWindow = r && now - r.getInt('window') < win;
      const changes = inWindow ? r.getInt('changes') : 0;
      if (changes >= RULES.limit.changes) {
        out = [429, { code: 'too_many_changes', wait: Math.ceil((r.getInt('window') + win - now) / 1000) }];
        return;
      }
      if (!r) {
        r = new Record(tx.findCollectionByNameOrId('producer_looks'));
        r.set('owner', uid);
      }
      r.set('avatar', b.avatar);
      r.set('frame', b.frame);
      r.set('backdrop', b.backdrop);
      r.set('rev', rev + 1);
      r.set('window', inWindow ? r.getInt('window') : now);
      r.set('changes', changes + 1);
      tx.save(r);
      out = [200, { ok: true, look: { avatar: b.avatar, frame: b.frame, backdrop: b.backdrop, rev: rev + 1, chosen: true } }];
    });
  } catch (x) {
    // a parallel first write won the unique owner: the page must reload the current look
    out = [409, { code: 'look_changed', look: lookOf(e.app, uid) }];
  }
  return e.json(out[0], out[1]);
}

module.exports = { RULES: RULES, defaultLook: defaultLook, lookOf: lookOf, publicLook: publicLook, publicLooks: publicLooks, get: get, put: put };
