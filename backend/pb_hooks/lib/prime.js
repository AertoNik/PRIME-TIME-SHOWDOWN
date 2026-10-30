// PRIME TIME: SHOWDOWN — Alpha 1.8.1: the server side of PRIME ID accounts and cloud saves.
// Loaded with require() inside every handler (PocketBase runs each handler in its own JS context).
//
// Every write to saves / save_history happens here, never through the generic records API:
//   - the owner is always the signed-in user (e.auth) — a request cannot name anyone else;
//   - the account must have a confirmed email;
//   - the data is size-limited, hashed (SHA-256 of the exact text) and validated;
//   - revision check, history copy and the write happen in ONE database transaction, so of two
//     requests replacing the same revision exactly one wins and the other gets 409 «conflict»;
//   - a request carries an id (op): a repeated request (the reply was lost) is recognised and
//     answered again without writing a second time;
//   - 1.8.3: a request must come from the account's ACTIVE GAME SESSION (key + generation, checked
//     in the same transaction as the write): a page that lost the session cannot write any more.

const V = require('./validate.js');
const RULES = require('./save_rules.js');
const AGE = require('./age_rules.js');
const LEGAL = require('./legal.js');
const GUARD = require('./guard.js');

const HISTORY_MAX = 10;
const OP_RE = /^[A-Za-z0-9_-]{8,64}$/;
const PUT_REASONS = ['sync', 'transfer', 'new', 'resolve-device', 'replace-damaged'];
const ARCHIVE_REASONS = ['conflict-device', 'before-restore', 'session-device'];

// 1.8.3: game sessions
const SESSION_HEARTBEAT_MS = 20000;
/** A session not confirmed for this long counts as gone (shown to the next device; the game stops starting matches). */
const SESSION_TTL_MS = 75000;
const SESSION_KEY_RE = /^[a-f0-9]{32}$/;

function body(e) {
  const b = e.requestInfo().body;
  return b && typeof b === 'object' ? b : {};
}

function short(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
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

function saveInfo(r) {
  if (!r) return { revision: 0, hash: '', schema: 0, updated: '' };
  return { revision: r.getInt('revision'), hash: r.getString('hash'), schema: r.getInt('schema'), updated: r.getString('updated') };
}

// ------------------------------------------------------------- registration mode
/**
 * 1.8.2: who may create an account on this server — set by the server's environment
 * (PRIME_REGISTRATION), never by the game: «disabled» (nobody), «invite_only» (closed beta: a valid
 * invite is required), «public». Missing or misspelt → «disabled»: registration stays closed.
 */
function mode() {
  const m = V.registrationMode($os.getenv('PRIME_REGISTRATION'));
  // 1.8.4: a public registration needs real email (every new account confirms its address) — a server
  // without it stays closed instead of opening an unprotected registration (the start log says why)
  if (m === 'public' && mailMode() === 'off') return 'disabled';
  return m;
}

/** 1.8.4: the age rules this server applies (see lib/age_rules.js; set in its environment). */
function ageRules() {
  return { rules: AGE.parseRules($os.getenv('PRIME_AGE_RULES')), closed: AGE.parseClosed($os.getenv('PRIME_CLOSED_COUNTRIES')), self: AGE.parseDefault($os.getenv('PRIME_AGE_DEFAULT')) };
}

/**
 * 1.8.2: can this server send email at all?
 *   «smtp»  — a real provider (PRIME_MAIL_MODE=smtp);
 *   «local» — the test catcher on this computer (Mailpit), only when the start script points
 *             PRIME_SMTP_HOST at the loopback address (npm run backend, the checks);
 *   «off»   — anything else (a VPS before SMTP is chosen, PRIME_MAIL_MODE=manual…): no email is
 *             attempted, the administrator confirms test accounts by hand in the dashboard.
 */
function mailMode() {
  const m = String($os.getenv('PRIME_MAIL_MODE') || '').trim();
  if (m === 'smtp') return 'smtp';
  if (m === '') {
    const host = String($os.getenv('PRIME_SMTP_HOST') || '').trim().toLowerCase();
    if (host === '127.0.0.1' || host === 'localhost' || host === '::1') return 'local';
  }
  return 'off';
}

/**
 * 1.8.3: one active game session per account — «on» unless the server sets PRIME_SESSIONS=off (the
 * emergency switch back to the 1.8.2 behaviour: saves without a session are accepted again and the
 * game is told so; nothing in the database changes either way).
 */
function sessionsMode() {
  return String($os.getenv('PRIME_SESSIONS') || '').trim() === 'off' ? 'off' : 'on';
}

/** What the game may know about this server (public; no secrets). */
function config(e) {
  const m = mode();
  return e.json(200, {
    registration: m,
    inviteRequired: m === 'invite_only',
    beta: m === 'invite_only',
    schemaMax: RULES.schemaMax,
    gameUrl: String($os.getenv('PRIME_GAME_URL') || '').slice(0, 200),
    // without email the game must not promise letters: accounts wait for the administrator
    mail: mailMode() !== 'off',
    verification: mailMode() === 'off' ? 'manual' : 'email',
    // 1.8.3: 1 = cloud writes need the account's active game session (0 / missing: the 1.8.2 rules)
    sessions: sessionsMode() === 'on' ? 1 : 0,
    session: { heartbeatMs: SESSION_HEARTBEAT_MS, ttlMs: SESSION_TTL_MS },
    // 1.8.4: documents to accept (versions), the age rules, a proof of work for registration, and the
    // account's own data tools (export, deletion, «send again» with a timer)
    legal: LEGAL.publicInfo(),
    age: (function () {
      const a = ageRules();
      return { min: AGE.MIN_AGE, self: a.self, rules: a.rules, closed: a.closed };
    })(),
    pow: 1,
    account: 1,
    // 1.8.8 stage 3: this server knows PRIME CHECKOUT (/api/prime/shop/*); sales and payments are told
    // per account by /api/prime/shop/status. Stage 4: payments: 1 — orders, the Robokassa notifications and
    // the registry of rights exist here (whether payments are switched ON is /api/prime/shop/status)
    // 1.8.8: and the catalog's truth — does this server sell now (sales open AND payments configured), in which
    // mode (test on a staging server) and at which prices (kopecks; null = not approved): the same numbers
    // PRIME CHECKOUT and the payment page use
    shop: (function () {
      const PAY = require(`${__hooks}/lib/payments.js`);
      const cfg = PAY.config();
      const env = PAY.shopEnv(cfg);
      // prices: the OFFICIAL prices (approved by the owner); charge: what a payment in this mode asks (test: the
      // staging amounts; demo and live: the official price — Robokassa's test mode moves no money)
      return { checkout: 1, payments: 1, selling: PAY.payReady(cfg) && PAY.salesOpen(cfg), env: env, prices: PAY.listPrices(), charge: PAY.pricesFor(env), demoUntil: cfg.ready && cfg.env === 'demo' ? cfg.demoDay : '' };
    })(),
    // 1.8.9: DAILY PRIME STREAK on this server (/api/prime/daily); 0 — the game shows no gift
    daily: require(`${__hooks}/lib/daily.js`).enabled() ? 1 : 0,
    // 1.9.0: PRIME LEAGUE on this server (PRIME_LEAGUE=on), its rules version and the fight's SIM_VERSION
    league: require(`${__hooks}/lib/league.js`).publicConfig(),
    // 1.9.0: PRIME PRODUCER AVATARS on this server (/api/prime/producer) — the catalogue version
    producer: require(`${__hooks}/lib/producer_rules.js`).version,
  });
}

/** The invite's state at this moment (inside the registration transaction). */
function inviteProblem(inv) {
  if (!inv) return 'invite_invalid';
  if (inv.getString('revokedAt')) return 'invite_invalid'; // a revoked code reads like a wrong one
  if (inv.getInt('uses') >= inv.getInt('maxUses')) return 'invite_used';
  const exp = inv.getString('expiresAt');
  if (exp && Date.parse(exp.replace(' ', 'T')) <= Date.now()) return 'invite_expired';
  return null;
}

// ------------------------------------------------------------------------ register
/**
 * 1.8.9.5: the address already has a PRIME ID — the SAME answer as a new registration, so the answer never tells
 * whether an address is registered (account enumeration). The address's owner gets a short notice instead (sign in
 * or reset the password); it goes through onMailerSend like every letter, so the usual limits apply (one a minute
 * and a few a day per address, the daily cap) — a refused or failed letter changes nothing in the answer.
 */
function takenAnswer(e, email) {
  if (mailMode() === 'off') return e.json(200, { ok: true, mailSent: false, verification: 'manual' });
  try {
    const meta = e.app.settings().meta;
    const game = /^https?:\/\/[^\s"'<>]+$/.test(String($os.getenv('PRIME_GAME_URL') || '')) ? String($os.getenv('PRIME_GAME_URL')).slice(0, 200) : '';
    const link = game ? '<p><a href="' + game + '">' + game + '</a></p>' : '';
    const msg = new MailerMessage({
      from: { address: meta.senderAddress, name: meta.senderName },
      to: [{ address: email }],
      subject: 'PRIME TIME: SHOWDOWN — попытка регистрации / registration attempt',
      html:
        '<p>Кто-то — возможно, вы — пытался создать PRIME ID с этим адресом. Аккаунт с ним уже есть: войдите в игре или восстановите пароль («Забыли пароль?»). Если это были не вы, ничего делать не нужно — новый аккаунт не создан.</p>' +
        '<p>Someone — maybe you — tried to create a PRIME ID with this address. It already has an account: sign in in the game or reset the password («Forgot password?»). If it was not you, there is nothing to do — no new account was created.</p>' +
        link,
    });
    e.app.newMailClient().send(msg);
  } catch (err) {
    // never the address itself in the log
    e.app.logger().info('prime register: notice to an existing address not sent', 'error', String(err).slice(0, 120));
  }
  return e.json(200, { ok: true, mailSent: true, verification: 'email', retryAfter: GUARD.MAIL_GAP_S });
}

function register(e) {
  const m = mode();
  if (m === 'disabled') return fail(e, 403, 'registration_closed');
  const b = body(e);
  const nickname = typeof b.nickname === 'string' ? b.nickname.trim() : '';
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const password = typeof b.password === 'string' ? b.password : '';
  const passwordConfirm = typeof b.passwordConfirm === 'string' ? b.passwordConfirm : '';
  // 1.8.4: an invisible field people never fill (only form-filling robots do)
  if (typeof b.website === 'string' && b.website.trim()) return fail(e, 400, 'register_failed');
  const bad = V.checkRegistration({ nickname: nickname, email: email, password: password, passwordConfirm: passwordConfirm });
  if (bad) return fail(e, 400, bad);
  // 1.8.4: age and country (decided here, whatever the page did), then the required documents
  const lang = b.lang === 'en' ? 'en' : 'ru';
  const ar = ageRules();
  const country = typeof b.country === 'string' ? b.country.trim().toUpperCase() : '';
  const age = AGE.decide(country, b.age, ar.rules, ar.closed, ar.self);
  if (!age.ok) return fail(e, age.code === 'age_invalid' || age.code === 'country_invalid' || age.code === 'country_required' ? 400 : 403, age.code);
  const docs = LEGAL.requiredDocs();
  const legalBad = LEGAL.checkAccept(b.accept, docs);
  if (legalBad) return fail(e, legalBad === 'legal_outdated' ? 409 : 400, legalBad, { legal: LEGAL.publicInfo() });
  // closed beta: a valid invite, checked and used in the very same transaction as the new account
  let inviteHash = '';
  if (m === 'invite_only') {
    const raw = typeof b.invite === 'string' ? b.invite : '';
    if (!raw.trim()) return fail(e, 400, 'invite_required');
    const code = V.normalizeInvite(raw);
    if (!code) return fail(e, 400, 'invite_invalid');
    inviteHash = $security.sha256(V.inviteHashInput(code));
  }
  // 1.8.4: one solved, one-time challenge per attempt (spent even if the attempt fails below)
  const powBad = GUARD.consumeChallenge(e.app, b.pow);
  if (powBad) return fail(e, 400, powBad);
  const key = V.nicknameKey(nickname);
  let userId = '';
  try {
    e.app.runInTransaction((tx) => {
      let invite = null;
      if (inviteHash) {
        invite = findOne(tx, 'invites', 'codeHash = {:h}', { h: inviteHash });
        const problem = inviteProblem(invite);
        if (problem) throw new Error('prime:' + problem);
      }
      let taken = null;
      try {
        taken = tx.findAuthRecordByEmail('users', email);
      } catch (_) {
        taken = null;
      }
      if (taken) throw new Error('prime:email_taken');
      if (findOne(tx, 'profiles', 'nicknameKey = {:k}', { k: key })) throw new Error('prime:nickname_taken');
      const user = new Record(tx.findCollectionByNameOrId('users'));
      user.setEmail(email);
      user.setPassword(password);
      user.setVerified(false);
      user.set('emailVisibility', false);
      tx.save(user);
      const profile = new Record(tx.findCollectionByNameOrId('profiles'));
      profile.set('user', user.id);
      profile.set('nickname', nickname);
      profile.set('nicknameKey', key);
      tx.save(profile);
      // 1.8.4: what was accepted, in the same transaction — no account exists without its records
      LEGAL.record(tx, user.id, docs, 'register', lang, b.privacy, { country: country, band: age.band });
      if (invite) {
        // one more use; with two simultaneous registrations the transactions run one after the
        // other, so the second one sees the code already used and is refused
        invite.set('uses', invite.getInt('uses') + 1);
        invite.set('usedAt', new Date().toISOString());
        invite.set('usedBy+', user.id);
        tx.save(invite);
      }
      userId = user.id;
    });
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    for (const code of ['invite_invalid', 'invite_used', 'invite_expired']) if (msg.indexOf('prime:' + code) >= 0) return fail(e, 400, code);
    if (msg.indexOf('prime:email_taken') >= 0) return takenAnswer(e, email);
    if (msg.indexOf('prime:nickname_taken') >= 0 || msg.indexOf('nicknameKey') >= 0) return fail(e, 409, 'nickname_taken');
    if (msg.indexOf('email') >= 0 && msg.indexOf('unique') >= 0) return takenAnswer(e, email);
    // never log the request body: it holds the password
    e.app.logger().warn('prime register failed', 'error', msg.slice(0, 300));
    return fail(e, 400, 'register_failed');
  }
  // no email on this server: nothing is attempted, the administrator confirms the account by hand
  if (mailMode() === 'off') return e.json(200, { ok: true, mailSent: false, verification: 'manual' });
  let mailSent = true;
  try {
    const user = e.app.findRecordById('users', userId);
    $mails.sendRecordVerification(e.app, user);
  } catch (err) {
    mailSent = false;
    e.app.logger().warn('prime verification email failed', 'error', String(err).slice(0, 300));
  }
  return e.json(200, { ok: true, mailSent: mailSent, verification: 'email', retryAfter: GUARD.MAIL_GAP_S });
}

// ------------------------------------------------------------------------------ me
function me(e) {
  const u = e.auth;
  const p = findOne(e.app, 'profiles', 'user = {:u}', { u: u.id });
  const s = findOne(e.app, 'saves', 'owner = {:u}', { u: u.id });
  return e.json(200, {
    id: u.id,
    email: u.email(),
    verified: u.verified(),
    created: u.getString('created'),
    nickname: p ? p.getString('nickname') : null,
    save: s ? saveInfo(s) : null,
    schemaMax: RULES.schemaMax,
    // 1.8.4: what this account still has to accept before PRIME CLOUD continues ([] = nothing)
    legal: { needs: LEGAL.needs(e.app, u.id) },
  });
}

// ------------------------------------------------------------------- shared checks
function requireVerified(e) {
  if (!e.auth || !e.auth.verified()) {
    fail(e, 403, 'not_verified');
    return false;
  }
  // 1.8.4: the current documents (and the age question) come first — reading, exporting and deleting
  // the account stay open without them
  const needs = LEGAL.needs(e.app, e.auth.id);
  if (needs.length) {
    fail(e, 403, 'terms_required', { needs: needs });
    return false;
  }
  return true;
}

/** The uploaded text: hash matches, JSON is a valid save. Returns { ok, text, hash, schema } or sends the error. */
function readUpload(e, b) {
  const text = b.data;
  const hash = typeof b.hash === 'string' ? b.hash.toLowerCase() : '';
  if (typeof text !== 'string') {
    fail(e, 400, 'invalid_data');
    return null;
  }
  if (V.utf8Length(text) > V.MAX_SAVE_BYTES) {
    fail(e, 413, 'too_large');
    return null;
  }
  if (!/^[a-f0-9]{64}$/.test(hash) || $security.sha256(text) !== hash) {
    fail(e, 400, 'hash_mismatch');
    return null;
  }
  // 1.8.8 stage 4: a fighter opened by a PRIME SHOP purchase may be the selected one, although the purchase
  // is never written into the save (the server's registry of rights says so — lib/payments.js)
  const c = V.checkSaveText(text, { paidFighters: require(`${__hooks}/lib/payments.js`).paidFighters(e.app, e.auth.id) });
  if (!c.ok) {
    e.app.logger().info('prime save rejected', 'user', e.auth.id, 'code', c.code, 'problems', c.problems.join('; ').slice(0, 500));
    fail(e, c.code === 'schema_unsupported' ? 409 : 400, c.code, { problems: c.problems.slice(0, 5) });
    return null;
  }
  return { text: text, hash: hash, schema: c.schema };
}

function archive(tx, uid, fields, reason) {
  const h = new Record(tx.findCollectionByNameOrId('save_history'));
  h.set('owner', uid);
  for (const k of ['data', 'schema', 'client', 'revision', 'hash', 'device', 'op']) h.set(k, fields[k]);
  h.set('reason', reason);
  tx.save(h);
}

function archiveRecord(tx, uid, r, reason) {
  archive(
    tx,
    uid,
    {
      data: r.getString('data'),
      schema: r.getInt('schema'),
      client: r.getString('client'),
      revision: r.getInt('revision'),
      hash: r.getString('hash'),
      device: r.getString('device'),
      op: r.getString('op'),
    },
    reason,
  );
}

/** Keep the newest HISTORY_MAX copies of this account. */
function prune(tx, uid) {
  const old = tx.findRecordsByFilter('save_history', 'owner = {:u}', '-created,-revision', 200, HISTORY_MAX, { u: uid });
  for (const r of old) if (r) tx.delete(r);
}

/** Was this request (op) already applied? (now current, or kept in the history since) */
function applied(tx, uid, cur, op) {
  if (cur && cur.getString('op') === op) return { revision: cur.getInt('revision'), hash: cur.getString('hash'), superseded: false };
  const h = findOne(tx, 'save_history', 'owner = {:u} && op = {:op} && reason != "conflict-device" && reason != "before-restore-device" && reason != "session-device"', { u: uid, op: op });
  if (h) return { revision: h.getInt('revision'), hash: h.getString('hash'), superseded: true };
  return null;
}

// ------------------------------------------------------------- game sessions (1.8.3)
const sessionHash = (key) => $security.sha256('prime-session:v1:' + key);
const nowMs = () => Date.now();

/** «iPhone · Safari»: letters, digits, spaces and a few signs only (it is shown to the other device). */
function cleanLabel(v) {
  return typeof v === 'string' ? v.replace(/[^A-Za-z0-9\u0400-\u04FF ·._()-]/g, '').trim().slice(0, 40) : '';
}

/** The session named by a request body: { key, generation } — or null if missing or malformed. */
function sessionArg(b) {
  const s = b && typeof b.session === 'object' && b.session ? b.session : null;
  if (!s) return null;
  const key = typeof s.key === 'string' ? s.key : '';
  const g = s.generation;
  if (!SESSION_KEY_RE.test(key) || typeof g !== 'number' || !isFinite(g) || Math.floor(g) !== g || g < 1) return null;
  return { key: key, generation: g };
}

function sessionLive(rec) {
  return !!rec && !rec.getInt('releasedAt') && nowMs() - rec.getInt('heartbeatAt') < SESSION_TTL_MS;
}

/** What a page that lost the session is told (never the key or its hash). */
function supersededBody(rec) {
  return { code: 'session_superseded', generation: rec ? rec.getInt('generation') : 0, label: rec && !rec.getInt('releasedAt') ? rec.getString('label') : '', live: sessionLive(rec) };
}

/**
 * Inside a write transaction: may this request change the account's cloud data? null = yes.
 * Otherwise [status, body]: 426 for a game too old to name a session (1.8.2 and earlier — it must
 * not loop on it: an old game treats 426 as «refused» and stops), 409 when another page holds the
 * session now. The claim runs in a transaction on the same record, so the two are strictly ordered.
 */
function sessionProblem(tx, uid, b) {
  if (sessionsMode() === 'off') return null;
  const s = sessionArg(b);
  if (!s) return [426, { code: 'session_required' }];
  const rec = findOne(tx, 'game_sessions', 'user = {:u}', { u: uid });
  if (!rec || rec.getInt('releasedAt') > 0 || rec.getInt('generation') !== s.generation || rec.getString('keyHash') !== sessionHash(s.key)) return [409, supersededBody(rec)];
  return null;
}

/**
 * POST /api/prime/session/claim — this page becomes the account's active game session (opening the
 * game, «Продолжить здесь»). The same page claiming again keeps its generation; any other page takes
 * over: generation + 1, and every request of the previous page is refused from now on.
 */
function claimSession(e) {
  if (!requireVerified(e)) return;
  if (sessionsMode() === 'off') return fail(e, 409, 'sessions_off');
  const b = body(e);
  const uid = e.auth.id;
  const key = typeof b.key === 'string' ? b.key : '';
  if (!SESSION_KEY_RE.test(key)) return fail(e, 400, 'invalid_session');
  const h = sessionHash(key);
  const label = cleanLabel(b.label);
  const device = short(b.device, 64);
  let out = null;
  e.app.runInTransaction((tx) => {
    let rec = findOne(tx, 'game_sessions', 'user = {:u}', { u: uid });
    const t = nowMs();
    if (rec && !rec.getInt('releasedAt') && rec.getString('keyHash') === h) {
      rec.set('heartbeatAt', t);
      tx.save(rec);
      out = [200, { ok: true, generation: rec.getInt('generation'), previous: null, heartbeatMs: SESSION_HEARTBEAT_MS, ttlMs: SESSION_TTL_MS }];
      return;
    }
    const previous = sessionLive(rec) ? { label: rec.getString('label') } : null;
    if (!rec) {
      rec = new Record(tx.findCollectionByNameOrId('game_sessions'));
      rec.set('user', uid);
      rec.set('generation', 0);
    }
    const generation = rec.getInt('generation') + 1;
    rec.set('generation', generation);
    rec.set('keyHash', h);
    rec.set('label', label);
    rec.set('device', device);
    rec.set('claimedAt', t);
    rec.set('heartbeatAt', t);
    rec.set('releasedAt', 0);
    tx.save(rec);
    out = [200, { ok: true, generation: generation, previous: previous, heartbeatMs: SESSION_HEARTBEAT_MS, ttlMs: SESSION_TTL_MS }];
  });
  return e.json(out[0], out[1]);
}

/**
 * POST /api/prime/session/heartbeat — «still here». Never takes the session: a page that lost it
 * only learns so (409) and stops. A page whose session simply ran out while nobody else claimed
 * (offline for a while) keeps it — no other page could have written meanwhile.
 */
function heartbeat(e) {
  if (!requireVerified(e)) return;
  if (sessionsMode() === 'off') return fail(e, 409, 'sessions_off');
  const s = sessionArg(body(e));
  if (!s) return fail(e, 400, 'invalid_session');
  const uid = e.auth.id;
  let out = null;
  e.app.runInTransaction((tx) => {
    const rec = findOne(tx, 'game_sessions', 'user = {:u}', { u: uid });
    if (!rec || rec.getInt('releasedAt') > 0 || rec.getInt('generation') !== s.generation || rec.getString('keyHash') !== sessionHash(s.key)) {
      out = [409, supersededBody(rec)];
      return;
    }
    const renewed = !sessionLive(rec);
    rec.set('heartbeatAt', nowMs());
    tx.save(rec);
    out = [200, { ok: true, generation: rec.getInt('generation'), renewed: renewed, ttlMs: SESSION_TTL_MS }];
  });
  return e.json(out[0], out[1]);
}

/** POST /api/prime/session/release — signing out / playing as a guest here: the session is free (only its own page can free it). */
function releaseSession(e) {
  const s = sessionArg(body(e));
  if (!s) return fail(e, 400, 'invalid_session');
  const uid = e.auth.id;
  let released = false;
  e.app.runInTransaction((tx) => {
    const rec = findOne(tx, 'game_sessions', 'user = {:u}', { u: uid });
    if (rec && !rec.getInt('releasedAt') && rec.getInt('generation') === s.generation && rec.getString('keyHash') === sessionHash(s.key)) {
      rec.set('releasedAt', nowMs());
      tx.save(rec);
      released = true;
    }
  });
  return e.json(200, { ok: true, released: released });
}

// --------------------------------------------------------------------- PUT save
function putSave(e) {
  if (!requireVerified(e)) return;
  const b = body(e);
  const uid = e.auth.id;
  const op = typeof b.op === 'string' ? b.op : '';
  const base = b.base;
  const reason = PUT_REASONS.indexOf(b.reason) >= 0 ? b.reason : 'sync';
  if (!OP_RE.test(op)) return fail(e, 400, 'invalid_op');
  if (typeof base !== 'number' || !isFinite(base) || base < 0 || Math.floor(base) !== base) return fail(e, 400, 'invalid_base');
  const up = readUpload(e, b);
  if (!up) return;
  let out = null;
  e.app.runInTransaction((tx) => {
    const cur = findOne(tx, 'saves', 'owner = {:u}', { u: uid });
    const done = applied(tx, uid, cur, op);
    if (done) {
      // (a repeat of a write that DID land is answered as such, even after the session moved on:
      // that page then knows its progress is in the cloud — nothing is written either way)
      out = [200, { ok: true, duplicate: true, revision: done.revision, hash: done.hash, superseded: done.superseded }];
      return;
    }
    const lost = sessionProblem(tx, uid, b);
    if (lost) {
      out = lost;
      return;
    }
    const info = saveInfo(cur);
    // 1.8.4: the guest career moves only into an account WITHOUT cloud progress (its first save) — never
    // over an existing one (the game never asks that; a hand-made request gets the same «conflict»)
    if (base !== info.revision || (reason === 'transfer' && cur)) {
      out = [409, { code: 'conflict', revision: info.revision, hash: info.hash, schema: info.schema, updated: info.updated }];
      return;
    }
    if (cur && up.schema < info.schema) {
      // an older game must not replace a newer schema (it would drop the fields it does not know)
      out = [409, { code: 'schema_downgrade', revision: info.revision, schema: info.schema }];
      return;
    }
    if (cur && info.hash === up.hash) {
      out = [200, { ok: true, unchanged: true, revision: info.revision, hash: info.hash }];
      return;
    }
    let rec = cur;
    if (rec) archiveRecord(tx, uid, rec, reason === 'resolve-device' ? 'conflict-cloud' : reason === 'replace-damaged' ? 'damaged' : 'previous');
    else {
      rec = new Record(tx.findCollectionByNameOrId('saves'));
      rec.set('owner', uid);
    }
    rec.set('data', up.text);
    rec.set('schema', up.schema);
    rec.set('client', short(b.client, 32));
    rec.set('revision', info.revision + 1);
    rec.set('hash', up.hash);
    rec.set('device', short(b.device, 64));
    rec.set('op', op);
    rec.set('reason', reason);
    tx.save(rec);
    prune(tx, uid);
    out = [200, { ok: true, revision: info.revision + 1, hash: up.hash, updated: rec.getString('updated') }];
  });
  return e.json(out[0], out[1]);
}

// ---------------------------------------------------- archive a device copy
/** Keep this device's version in the account history (chosen «use the cloud» in a conflict, before a restore). */
function archiveSave(e) {
  if (!requireVerified(e)) return;
  const b = body(e);
  const uid = e.auth.id;
  const reason = ARCHIVE_REASONS.indexOf(b.reason) >= 0 ? b.reason : 'conflict-device';
  const up = readUpload(e, b);
  if (!up) return;
  let out = null;
  e.app.runInTransaction((tx) => {
    const lost = sessionProblem(tx, uid, b);
    if (lost) {
      out = lost;
      return;
    }
    if (findOne(tx, 'save_history', 'owner = {:u} && hash = {:h}', { u: uid, h: up.hash })) {
      out = [200, { ok: true, duplicate: true }];
      return;
    }
    const cur = findOne(tx, 'saves', 'owner = {:u}', { u: uid });
    if (cur && cur.getString('hash') === up.hash) {
      out = [200, { ok: true, duplicate: true }];
      return;
    }
    archive(tx, uid, { data: up.text, schema: up.schema, client: short(b.client, 32), revision: cur ? cur.getInt('revision') : 0, hash: up.hash, device: short(b.device, 64), op: '' }, reason === 'before-restore' ? 'before-restore-device' : reason === 'session-device' ? 'session-device' : 'conflict-device');
    prune(tx, uid);
    out = [200, { ok: true }];
  });
  return e.json(out[0], out[1]);
}

// ----------------------------------------------------------- restore from history
function restoreSave(e) {
  if (!requireVerified(e)) return;
  const b = body(e);
  const uid = e.auth.id;
  const op = typeof b.op === 'string' ? b.op : '';
  const base = b.base;
  const id = typeof b.history === 'string' ? b.history : '';
  if (!OP_RE.test(op)) return fail(e, 400, 'invalid_op');
  if (typeof base !== 'number' || !isFinite(base) || base < 0 || Math.floor(base) !== base) return fail(e, 400, 'invalid_base');
  if (!/^[a-z0-9]{15}$/.test(id)) return fail(e, 404, 'not_found');
  let out = null;
  e.app.runInTransaction((tx) => {
    // another account's copy is answered exactly like a missing one
    const h = findOne(tx, 'save_history', 'id = {:id} && owner = {:u}', { id: id, u: uid });
    if (!h) {
      out = [404, { code: 'not_found' }];
      return;
    }
    const cur = findOne(tx, 'saves', 'owner = {:u}', { u: uid });
    const done = applied(tx, uid, cur, op);
    if (done) {
      out = [200, { ok: true, duplicate: true, revision: done.revision, hash: done.hash }];
      return;
    }
    const lost = sessionProblem(tx, uid, b);
    if (lost) {
      out = lost;
      return;
    }
    const info = saveInfo(cur);
    if (base !== info.revision) {
      out = [409, { code: 'conflict', revision: info.revision, hash: info.hash, schema: info.schema, updated: info.updated }];
      return;
    }
    if (h.getInt('schema') > RULES.schemaMax) {
      out = [409, { code: 'schema_unsupported', schema: h.getInt('schema') }];
      return;
    }
    if (cur && info.hash === h.getString('hash')) {
      out = [200, { ok: true, unchanged: true, revision: info.revision, hash: info.hash }];
      return;
    }
    let rec = cur;
    if (rec) archiveRecord(tx, uid, rec, 'before-restore');
    else {
      rec = new Record(tx.findCollectionByNameOrId('saves'));
      rec.set('owner', uid);
    }
    rec.set('data', h.getString('data'));
    rec.set('schema', h.getInt('schema'));
    rec.set('client', h.getString('client'));
    rec.set('revision', info.revision + 1);
    rec.set('hash', h.getString('hash'));
    rec.set('device', short(b.device, 64));
    rec.set('op', op);
    rec.set('reason', 'restore');
    tx.save(rec);
    prune(tx, uid);
    out = [200, { ok: true, revision: info.revision + 1, hash: h.getString('hash') }];
  });
  return e.json(out[0], out[1]);
}

// -------------------------------------------------------------------- mail guard
/**
 * An email may only go to the SMTP catcher on this computer — unless the server explicitly enables
 * real email (PRIME_MAIL_MODE=smtp, set on the future VPS once a provider is chosen).
 */
function guardMail(e) {
  const m = mailMode();
  if (m === 'smtp') return;
  if (m === 'off') throw new Error('PRIME: this server sends no email (PRIME_MAIL_MODE is not smtp) — accounts are confirmed by the administrator');
  const smtp = e.app.settings().smtp;
  const host = String(smtp.host || '').toLowerCase();
  if (!smtp.enabled || (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1')) {
    throw new Error('PRIME: outgoing email is allowed only to the local test catcher (Mailpit on 127.0.0.1) unless PRIME_MAIL_MODE=smtp');
  }
}

/** 1.8.4: the email limits (lib/guard.js) — relaxed only for the old checks on this computer (Mailpit). */
function limitMail(e) {
  if (mailMode() === 'local' && String($os.getenv('PRIME_MAIL_LIMITS') || '').trim() === 'relaxed') return;
  const to = [];
  for (const a of e.message.to || []) if (a && a.address) to.push(String(a.address));
  GUARD.limitMail(e.app, to);
}

/**
 * Without email (mailMode «off») PocketBase's own «send me a letter» endpoints (verification,
 * password reset, email change) answer the same 503 for every address: no letter is attempted,
 * and the answer does not tell whether an account exists.
 */
function blockMailRequests(e) {
  if (e.request.method === 'POST' && /^\/api\/collections\/[^/]+\/request-(verification|password-reset|email-change)$/.test(e.request.url.path) && mailMode() === 'off') {
    return fail(e, 503, 'mail_unavailable');
  }
  return e.next();
}

module.exports = {
  mode: mode,
  mailMode: mailMode,
  sessionsMode: sessionsMode,
  blockMailRequests: blockMailRequests,
  config: config,
  register: register,
  me: me,
  claimSession: claimSession,
  heartbeat: heartbeat,
  releaseSession: releaseSession,
  putSave: putSave,
  archiveSave: archiveSave,
  restoreSave: restoreSave,
  guardMail: guardMail,
  limitMail: limitMail,
  ageRules: ageRules,
  // 1.8.9: DAILY PRIME STREAK (lib/daily.js) writes the reward into the cloud save with the same checks
  requireVerified: requireVerified,
  sessionProblem: sessionProblem,
  saveInfo: saveInfo,
  archiveRecord: archiveRecord,
  prune: prune,
};
