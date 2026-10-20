// PRIME TIME: SHOWDOWN — Alpha 1.8.4: protection of a PUBLIC registration (no invite stops anyone).
//
//   proof of work   every registration spends one fresh, one-time challenge: the browser looks for a
//                   number whose SHA-256 starts with N zero bits (about a second on a phone, while the
//                   player types). No third party, no cookie, nothing about the player. It does not
//                   «detect» a bot — it makes thousands of sign-ups expensive, together with the limits.
//   email limits    per address: one letter a minute, a few a day; per server: a daily cap (the
//                   provider's own limits and the sender's reputation). Counted for every letter
//                   PocketBase sends — registration, «send again», password reset.
//   sign-in         per typed address: after 10 wrong passwords in 15 minutes the address is refused
//                   for a while (the same answer whether or not an account exists).
//   cleanup         hourly: old counters and challenges go; a 1.8.4 registration never confirmed within
//                   PRIME_UNVERIFIED_DAYS (7) is deleted (it holds a nickname and somebody's address).
//   deletions       the id of every deleted account is noted OUTSIDE the database (next to pb_data) for
//                   60 days; after a restore from an older backup the server deletes those accounts again.
//
// Counters store a SHA-256 of the address, never the address itself.

const POW_TTL_MS = 10 * 60 * 1000;
const POW_OPEN_MAX = 5000;
const MAIL_GAP_S = 60;
const MAIL_PER_DAY = 6;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX = 10;
const DELETE_WINDOW_MS = 60 * 60 * 1000;
const DELETE_MAX = 5;
const DELETIONS_KEEP_DAYS = 60;
const DAY_MS = 24 * 3600 * 1000;

function env(k) {
  return String($os.getenv(k) || '').trim();
}

function intEnv(k, def, min, max) {
  const n = parseInt(env(k), 10);
  return isFinite(n) && n >= min && n <= max ? n : def;
}

/** PocketBase's own date format («2026-10-20 12:00:00.000Z») — compares correctly as text. */
function pbDate(ms) {
  return new Date(ms).toISOString().replace('T', ' ');
}

function hash(kind, value) {
  return $security.sha256('prime-' + kind + ':v1:' + String(value || '').trim().toLowerCase());
}

// ------------------------------------------------------------------ counters
function hits(app, kind, key, sinceMs) {
  return app.countRecords('prime_limits', $dbx.exp('kind = {:k} AND key = {:key} AND created >= {:t}', { k: kind, key: key, t: pbDate(sinceMs) }));
}

function hitsAll(app, kind, sinceMs) {
  return app.countRecords('prime_limits', $dbx.exp('kind = {:k} AND created >= {:t}', { k: kind, t: pbDate(sinceMs) }));
}

function lastHit(app, kind, key) {
  try {
    const l = app.findRecordsByFilter('prime_limits', 'kind = {:k} && key = {:key}', '-created', 1, 0, { k: kind, key: key });
    return l && l.length ? Date.parse(l[0].getString('created').replace(' ', 'T')) : 0;
  } catch (_) {
    return 0;
  }
}

function addHit(app, kind, key) {
  const r = new Record(app.findCollectionByNameOrId('prime_limits'));
  r.set('kind', kind);
  r.set('key', key);
  app.save(r);
}

// -------------------------------------------------------------- proof of work
function powBits() {
  return intEnv('PRIME_POW_BITS', 18, 10, 24);
}

/** Leading zero bits of a hex digest. */
function zeroBits(hex) {
  let n = 0;
  for (let i = 0; i < hex.length; i++) {
    const v = parseInt(hex[i], 16);
    if (v === 0) {
      n += 4;
      continue;
    }
    n += v < 2 ? 3 : v < 4 ? 2 : v < 8 ? 1 : 0;
    break;
  }
  return n;
}

/** POST /api/prime/challenge → { id, salt, bits, expiresAt }. */
function issueChallenge(e) {
  const app = e.app;
  if (app.countRecords('prime_challenges', $dbx.exp('expiresAt > {:t}', { t: Date.now() })) >= POW_OPEN_MAX) {
    app.logger().warn('prime: too many open registration challenges (a flood?)');
    return e.json(503, { code: 'busy' });
  }
  const r = new Record(app.findCollectionByNameOrId('prime_challenges'));
  const salt = $security.randomStringWithAlphabet(32, '0123456789abcdef');
  const bits = powBits();
  const expiresAt = Date.now() + POW_TTL_MS;
  r.set('salt', salt);
  r.set('bits', bits);
  r.set('expiresAt', expiresAt);
  app.save(r);
  return e.json(200, { id: r.id, salt: salt, bits: bits, expiresAt: expiresAt });
}

/**
 * Spend a challenge: it is deleted FIRST (whatever comes next, it never works twice — two requests
 * with one challenge: the second finds nothing), then the answer is checked. null = solved.
 */
function consumeChallenge(app, pow) {
  const p = pow && typeof pow === 'object' ? pow : {};
  const id = typeof p.id === 'string' ? p.id : '';
  const nonce = typeof p.nonce === 'string' ? p.nonce : '';
  if (!/^[a-z0-9]{15}$/.test(id) || !/^[0-9]{1,12}$/.test(nonce)) return 'challenge_invalid';
  let c = null;
  try {
    app.runInTransaction((tx) => {
      const r = tx.findRecordById('prime_challenges', id);
      c = { salt: r.getString('salt'), bits: r.getInt('bits'), expiresAt: r.getFloat('expiresAt') };
      tx.delete(r);
    });
  } catch (_) {
    return 'challenge_invalid';
  }
  if (!c || c.expiresAt < Date.now()) return 'challenge_invalid';
  return zeroBits($security.sha256(c.salt + ':' + nonce)) >= c.bits ? null : 'challenge_invalid';
}

// ---------------------------------------------------------------- email limits
function mailCap() {
  return intEnv('PRIME_MAIL_DAILY_CAP', 90, 1, 100000);
}

/** For «send again»: how long until this address may get a letter (0 = now), and whether today's letters are used up. */
function mailState(app, address) {
  const key = hash('mail', address);
  const now = Date.now();
  const last = lastHit(app, 'mail', key);
  const wait = last ? Math.max(0, Math.ceil((last + MAIL_GAP_S * 1000 - now) / 1000)) : 0;
  const today = hits(app, 'mail', key, now - DAY_MS);
  return { wait: wait, limited: today >= MAIL_PER_DAY, gap: MAIL_GAP_S };
}

/**
 * Every outgoing letter (onMailerSend): refused — by throwing — over a limit. Requests answered by
 * PocketBase itself (password reset, «send verification» by address) still answer 204 as before:
 * the refusal is only in the server log, so nothing tells whether an address has an account.
 */
function limitMail(app, addresses) {
  const now = Date.now();
  if (hitsAll(app, 'mail', now - DAY_MS) >= mailCap()) {
    app.logger().warn('prime: daily email cap reached — letters wait until tomorrow (PRIME_MAIL_DAILY_CAP)');
    throw new Error('prime:mail_cap');
  }
  for (const a of addresses) {
    const st = mailState(app, a);
    if (st.wait > 0) throw new Error('prime:mail_wait');
    if (st.limited) throw new Error('prime:mail_limit');
  }
  for (const a of addresses) addHit(app, 'mail', hash('mail', a));
}

// --------------------------------------------------------------------- sign-in
/** onRecordAuthWithPasswordRequest (users): too many wrong passwords for one typed address → 429. */
function loginAttempt(e) {
  const key = hash('login', e.identity);
  if (hits(e.app, 'login', key, Date.now() - LOGIN_WINDOW_MS) >= LOGIN_MAX) {
    throw new ApiError(429, 'Too many failed sign-in attempts. Try again later.', {});
  }
  try {
    e.next();
  } catch (err) {
    try {
      addHit(e.app, 'login', key);
    } catch (_) {
      /* the counter is a help, never a reason to fail differently */
    }
    throw err;
  }
}

/** Deleting an account asks for the password again: at most 5 wrong ones an hour per account. */
function deleteAttemptsLeft(app, uid) {
  return hits(app, 'delete', hash('delete', uid), Date.now() - DELETE_WINDOW_MS) < DELETE_MAX;
}

function deleteFailed(app, uid) {
  addHit(app, 'delete', hash('delete', uid));
}

// ------------------------------------------------------------------- deletions
function deletionsPath(app) {
  const p = env('PRIME_DELETIONS_LOG');
  if (p) return p;
  const dir = String(app.dataDir()).replace(/\/+$/, '');
  return dir.replace(/\/[^/]*$/, '') + '/prime-deletions.log';
}

function readDeletions(app) {
  let text = '';
  try {
    text = toString($os.readFile(deletionsPath(app)));
  } catch (_) {
    return [];
  }
  const out = [];
  for (const line of text.split('\n')) {
    const m = /^([a-z0-9]{15})\t(\d{4}-\d\d-\d\dT[\d:.]+Z)$/.exec(line.trim());
    if (m) out.push({ id: m[1], at: m[2] });
  }
  return out;
}

function writeDeletions(app, list) {
  const keepFrom = Date.now() - DELETIONS_KEEP_DAYS * DAY_MS;
  const lines = list.filter((d) => Date.parse(d.at) >= keepFrom).map((d) => d.id + '\t' + d.at);
  $os.writeFile(deletionsPath(app), lines.length ? lines.join('\n') + '\n' : '', 384); // 0600: only the server
}

/** onRecordAfterDeleteSuccess (users): remember the id (only the id and the time). */
function noteDeletion(app, id) {
  const list = readDeletions(app);
  if (!list.some((d) => d.id === id)) list.push({ id: id, at: new Date().toISOString() });
  writeDeletions(app, list);
}

/** At every start: accounts deleted earlier but back from a restored backup are deleted again. */
function reapplyDeletions(app) {
  let n = 0;
  for (const d of readDeletions(app)) {
    let u = null;
    try {
      u = app.findRecordById('users', d.id);
    } catch (_) {
      u = null;
    }
    if (!u) continue;
    try {
      app.delete(u);
      n++;
    } catch (err) {
      app.logger().error('prime: could not delete again an account deleted earlier', 'id', d.id, 'error', String(err).slice(0, 200));
    }
  }
  if (n) {
    app.logger().warn('prime: accounts deleted earlier were back (restored backup) — deleted again', 'count', n);
    console.log('PRIME: ' + n + ' account(s) deleted earlier were back from a restored backup — deleted again');
  }
  return n;
}

// --------------------------------------------------------------------- cleanup
function unverifiedDays() {
  return intEnv('PRIME_UNVERIFIED_DAYS', 7, 0, 365);
}

/** Hourly (cron): old counters, spent challenges, never-confirmed 1.8.4 registrations, old deletion notes, deletions again. */
function cleanup(app) {
  const now = Date.now();
  const steps = [
    () => app.db().newQuery('DELETE FROM prime_limits WHERE created < {:t}').bind({ t: pbDate(now - 2 * DAY_MS) }).execute(),
    () => app.db().newQuery('DELETE FROM prime_challenges WHERE expiresAt < {:t}').bind({ t: now }).execute(),
    () => {
      const days = unverifiedDays();
      if (!days) return;
      // only accounts registered through 1.8.4 (they have a «register» record): older accounts are never touched here
      const old = app.findRecordsByFilter('users', 'verified = false && created < {:t} && @collection.consents.user ?= id && @collection.consents.action ?= "register"', 'created', 200, 0, { t: pbDate(now - days * DAY_MS) });
      for (const u of old) app.delete(u);
      if (old.length) app.logger().info('prime: deleted never-confirmed registrations', 'count', old.length);
    },
    () => writeDeletions(app, readDeletions(app)),
    // (also hourly: a backup restored while the server kept running is covered too)
    () => reapplyDeletions(app),
  ];
  for (const s of steps) {
    try {
      s();
    } catch (err) {
      app.logger().error('prime cleanup step failed', 'error', String(err).slice(0, 300));
    }
  }
}

module.exports = {
  MAIL_GAP_S,
  powBits,
  zeroBits,
  issueChallenge,
  consumeChallenge,
  mailState,
  limitMail,
  loginAttempt,
  deleteAttemptsLeft,
  deleteFailed,
  noteDeletion,
  reapplyDeletions,
  readDeletions,
  cleanup,
};
