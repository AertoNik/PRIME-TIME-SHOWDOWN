// PRIME TIME: SHOWDOWN — Alpha 1.8.4: the player's own account tools. Every route needs the signed-in
// account (e.auth) and acts on that account only — a request cannot name anyone else.
//
//   POST /api/prime/verify/resend    «send the email again» — with the time until the next one is allowed
//   POST /api/prime/legal/accept     accept the current documents (and answer the age question) — accounts
//                                    made before 1.8.4, or after a real change of the rules
//   GET  /api/prime/account/export   everything the server keeps about this account, as JSON
//   POST /api/prime/account/delete   delete this account (the password again) — profile, cloud save,
//                                    history, game session and records go with it, in one transaction

const AGE = require('./age_rules.js');
const LEGAL = require('./legal.js');
const GUARD = require('./guard.js');

function body(e) {
  const b = e.requestInfo().body;
  return b && typeof b === 'object' ? b : {};
}

function fail(e, status, code, extra) {
  const out = { code: code };
  if (extra) for (const k of Object.keys(extra)) out[k] = extra[k];
  return e.json(status, out);
}

function find(app, collection, filter, params, sort, limit) {
  try {
    return app.findRecordsByFilter(collection, filter, sort || '', limit || 0, 0, params);
  } catch (_) {
    return [];
  }
}

// ---------------------------------------------------------------- send again
function resendVerification(e) {
  const u = e.auth;
  if (u.verified()) return e.json(200, { ok: true, verified: true });
  const prime = require(`${__hooks}/lib/prime.js`);
  if (prime.mailMode() === 'off') return fail(e, 503, 'mail_unavailable');
  const st = GUARD.mailState(e.app, u.email());
  if (st.limited) return fail(e, 429, 'resend_limit', { retryAfter: 3600 });
  if (st.wait > 0) return fail(e, 429, 'resend_wait', { retryAfter: st.wait });
  try {
    $mails.sendRecordVerification(e.app, u);
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    if (msg.indexOf('prime:mail_wait') >= 0) return fail(e, 429, 'resend_wait', { retryAfter: GUARD.MAIL_GAP_S });
    if (msg.indexOf('prime:mail_limit') >= 0) return fail(e, 429, 'resend_limit', { retryAfter: 3600 });
    e.app.logger().warn('prime verification email failed (resend)', 'error', msg.slice(0, 300));
    return fail(e, 503, 'mail_failed');
  }
  return e.json(200, { ok: true, retryAfter: GUARD.MAIL_GAP_S });
}

// ------------------------------------------------------------- accept documents
function acceptLegal(e) {
  const uid = e.auth.id;
  const b = body(e);
  const needs = LEGAL.needs(e.app, uid);
  if (!needs.length) return e.json(200, { ok: true, legal: { needs: [] } });
  const lang = b.lang === 'en' ? 'en' : 'ru';
  const bad = LEGAL.checkAccept(b.accept, needs);
  if (bad) return fail(e, bad === 'legal_outdated' ? 409 : 400, bad, { legal: LEGAL.publicInfo() });
  let age = null;
  if (needs.indexOf('age') >= 0) {
    const prime = require(`${__hooks}/lib/prime.js`);
    const ar = prime.ageRules();
    const country = typeof b.country === 'string' ? b.country.trim().toUpperCase() : '';
    const d = AGE.decide(country, b.age, ar.rules, ar.closed);
    // below the country's age: nothing is written — the account stays, PRIME CLOUD waits, export and deletion work
    if (!d.ok) return fail(e, d.code === 'age_invalid' || d.code === 'country_invalid' || d.code === 'country_required' ? 400 : 403, d.code);
    age = { country: country, band: d.band };
  }
  e.app.runInTransaction((tx) => {
    // (two taps at once: the second finds nothing left to accept)
    const still = LEGAL.needs(tx, uid);
    if (!still.length) return;
    LEGAL.record(tx, uid, still, 'reaccept', lang, b.privacy, still.indexOf('age') >= 0 ? age : null);
  });
  return e.json(200, { ok: true, legal: { needs: LEGAL.needs(e.app, uid) } });
}

// --------------------------------------------------------------------- export
function saveOut(r, withReason) {
  const text = r.getString('data');
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (_) {
    data = text; // a damaged copy is given back exactly as stored
  }
  const out = {
    revision: r.getInt('revision'),
    schema: r.getInt('schema'),
    gameVersion: r.getString('client'),
    browserId: r.getString('device'),
    sha256: r.getString('hash'),
    data: data,
  };
  if (withReason) out.reason = r.getString('reason');
  out[withReason ? 'kept' : 'updated'] = r.getString(withReason ? 'created' : 'updated');
  return out;
}

function exportData(e) {
  const u = e.auth;
  const app = e.app;
  const p = find(app, 'profiles', 'user = {:u}', { u: u.id }, '', 1)[0];
  const s = find(app, 'saves', 'owner = {:u}', { u: u.id }, '', 1)[0];
  const hist = find(app, 'save_history', 'owner = {:u}', { u: u.id }, '-created', 20);
  const sess = find(app, 'game_sessions', 'user = {:u}', { u: u.id }, '', 1)[0];
  const cons = find(app, 'consents', 'user = {:u}', { u: u.id }, 'created', 200);
  const inv = find(app, 'invites', 'usedBy ?= {:u}', { u: u.id }, '', 1)[0];
  const ms = (n) => (n > 0 ? new Date(n).toISOString() : null);
  return e.json(200, {
    format: 'prime-id-export',
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    account: { id: u.id, email: u.email(), emailVerified: u.verified(), created: u.getString('created'), updated: u.getString('updated') },
    profile: p ? { nickname: p.getString('nickname'), created: p.getString('created') } : null,
    cloudSave: s ? saveOut(s, false) : null,
    saveHistory: hist.map((r) => saveOut(r, true)),
    gameSession: sess
      ? { deviceName: sess.getString('label'), browserId: sess.getString('device'), claimed: ms(sess.getFloat('claimedAt')), lastSeen: ms(sess.getFloat('heartbeatAt')), released: ms(sess.getFloat('releasedAt')) }
      : null,
    acceptedDocuments: cons.map((r) => {
      const o = { document: r.getString('doc'), version: r.getInt('version'), language: r.getString('lang'), action: r.getString('action'), at: r.getString('created') };
      if (r.getString('doc') === 'age') {
        o.country = r.getString('country');
        o.ageGroup = r.getString('ageBand');
      }
      // 1.8.8 stage 3: which exact text of the PRIME SHOP offer was accepted
      if (r.getString('docHash')) o.textSha256 = r.getString('docHash');
      return o;
    }),
    invite: inv ? { usedToRegister: true } : null,
    // 1.8.8 stage 4: PRIME SHOP — the account's orders (no card data is ever kept) and its rights
    purchases: require(`${__hooks}/lib/payments.js`).exportOf(app, u.id),
    notIncluded:
      'Пароль хранится только в виде хэша и не выгружается. Технические журналы сервера (IP-адрес, браузер, время запросов) хранятся ограниченное время и выдаются по запросу на primetimeshowdown.official@gmail.com. / The password is stored only as a hash and is not exported. Server logs (IP address, browser, request times) are kept for a limited time and are provided on request.',
  });
}

// --------------------------------------------------------------------- delete
function deleteAccount(e) {
  const app = e.app;
  const u = e.auth;
  const b = body(e);
  if (b.confirm !== 'DELETE') return fail(e, 400, 'delete_unconfirmed');
  const pw = typeof b.password === 'string' ? b.password : '';
  if (!GUARD.deleteAttemptsLeft(app, u.id)) return fail(e, 429, 'rate_limited');
  if (!pw || !u.validatePassword(pw)) {
    GUARD.deleteFailed(app, u.id);
    return fail(e, 400, 'password_wrong');
  }
  try {
    // one transaction: the account and everything attached to it (cascade) — all of it, or nothing
    app.runInTransaction((tx) => {
      tx.delete(tx.findRecordById('users', u.id));
    });
  } catch (err) {
    app.logger().error('prime: account deletion failed — nothing was deleted', 'error', String(err).slice(0, 300));
    return fail(e, 500, 'delete_failed');
  }
  return e.json(200, { ok: true });
}

module.exports = { resendVerification, acceptLegal, exportData, deleteAccount };
