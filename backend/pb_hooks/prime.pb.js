/// <reference path="../pb_data/types.d.ts" />

// PRIME TIME: SHOWDOWN — Alpha 1.8.1 «LOCAL ACCOUNTS» / 1.8.2 «CLOSED BETA»: the custom API.
// The logic lives in lib/prime.js (each handler loads it: PocketBase runs every handler in its own
// JS context, so top-level variables here are not visible inside them).
//
//   GET  /api/prime/config          the registration mode of this server (disabled | invite_only | public)
//                                   and whether it sends email (otherwise: manual confirmation)
//   POST /api/prime/register        nickname + email + password (+ invite in the closed beta) → user,
//                                   profile and the invite's use in ONE transaction, then the
//                                   verification email. The only way to create a player account:
//                                   the users collection has no create rule.
//   GET  /api/prime/me              the signed-in account: id, email, verified, nickname, cloud save info
//   POST /api/prime/session/claim   1.8.3: this page becomes the account's ONE active game session
//   POST /api/prime/session/heartbeat        «still here» (never takes the session back)
//   POST /api/prime/session/release          signing out / playing as a guest: the session is free
//   PUT  /api/prime/save            write the cloud save (owner = you, confirmed email, the active game
//                                   session, revision check, history copy, idempotent by op) — the only
//                                   way to change a save
//   POST /api/prime/save/archive    keep this device's version in the history (conflict «use the cloud»)
//   POST /api/prime/save/restore    1.8.4: refused for players (403 «restore_disabled») — nobody rolls their own
//                                   rewards, currency or achievements back; the history stays for the organiser
//   1.8.4 «PUBLIC REGISTRATION & ACCOUNT SAFETY» (lib/guard.js, lib/legal.js, lib/age_rules.js, lib/account.js):
//   POST /api/prime/challenge       a one-time proof-of-work challenge for the next registration
//   POST /api/prime/verify/resend   «send the email again» (signed in, not confirmed yet) — with its timer
//   POST /api/prime/legal/accept    accept the current documents / answer the age question
//   GET  /api/prime/account/export  everything the server keeps about the signed-in account (JSON)
//   POST /api/prime/account/delete  delete the signed-in account (password again)
//
// Reading the save and the history uses the generic records API, limited by the collection rules to
// the owner (see pb_migrations).

routerAdd('GET', '/api/prime/config', (e) => require(`${__hooks}/lib/prime.js`).config(e));

routerAdd('POST', '/api/prime/register', (e) => require(`${__hooks}/lib/prime.js`).register(e), $apis.bodyLimit(8 * 1024));

routerAdd('GET', '/api/prime/me', (e) => require(`${__hooks}/lib/prime.js`).me(e), $apis.requireAuth('users'));

// 1.8.3 PRIME CLOUD 2.0: one active game session per account (see lib/prime.js, «game sessions»)
routerAdd('POST', '/api/prime/session/claim', (e) => require(`${__hooks}/lib/prime.js`).claimSession(e), $apis.requireAuth('users'), $apis.bodyLimit(2 * 1024));

routerAdd('POST', '/api/prime/session/heartbeat', (e) => require(`${__hooks}/lib/prime.js`).heartbeat(e), $apis.requireAuth('users'), $apis.bodyLimit(2 * 1024));

routerAdd('POST', '/api/prime/session/release', (e) => require(`${__hooks}/lib/prime.js`).releaseSession(e), $apis.requireAuth('users'), $apis.bodyLimit(2 * 1024));

routerAdd('PUT', '/api/prime/save', (e) => require(`${__hooks}/lib/prime.js`).putSave(e), $apis.requireAuth('users'), $apis.bodyLimit(720 * 1024));

routerAdd('POST', '/api/prime/save/archive', (e) => require(`${__hooks}/lib/prime.js`).archiveSave(e), $apis.requireAuth('users'), $apis.bodyLimit(720 * 1024));

// 1.8.4: a player may not put an earlier version of their own save back (that would return spent currency,
// lost rewards…). lib/prime.js keeps restoreSave for a future organiser tool; the organiser restores
// through the dashboard today (docs/PRIME_CLOUD_2_DEPLOY.md, «Восстановление прогресса»).
routerAdd('POST', '/api/prime/save/restore', (e) => e.json(403, { code: 'restore_disabled' }), $apis.requireAuth('users'), $apis.bodyLimit(8 * 1024));

// 1.8.4: registration protection and the player's own account tools
routerAdd('POST', '/api/prime/challenge', (e) => require(`${__hooks}/lib/guard.js`).issueChallenge(e), $apis.bodyLimit(1024));

routerAdd('POST', '/api/prime/verify/resend', (e) => require(`${__hooks}/lib/account.js`).resendVerification(e), $apis.requireAuth('users'), $apis.bodyLimit(1024));

routerAdd('POST', '/api/prime/legal/accept', (e) => require(`${__hooks}/lib/account.js`).acceptLegal(e), $apis.requireAuth('users'), $apis.bodyLimit(4 * 1024));

routerAdd('GET', '/api/prime/account/export', (e) => require(`${__hooks}/lib/account.js`).exportData(e), $apis.requireAuth('users'));

routerAdd('POST', '/api/prime/account/delete', (e) => require(`${__hooks}/lib/account.js`).deleteAccount(e), $apis.requireAuth('users'), $apis.bodyLimit(4 * 1024));

// 1.8.2: a server without email (no PRIME_MAIL_MODE=smtp, no local catcher) answers PocketBase's own
// verification / password-reset / email-change requests with 503 «mail_unavailable» — for every address
routerUse((e) => {
  if (e.request.method !== 'POST' || !/\/request-(verification|password-reset|email-change)$/.test(e.request.url.path)) return e.next();
  return require(`${__hooks}/lib/prime.js`).blockMailRequests(e);
});

// every outgoing email: only to the SMTP catcher on this computer, unless the server enables real
// email explicitly (PRIME_MAIL_MODE=smtp); none at all on a server without email
onMailerSend((e) => {
  const prime = require(`${__hooks}/lib/prime.js`);
  prime.guardMail(e);
  // 1.8.4: per-address and daily limits for every letter (lib/guard.js)
  prime.limitMail(e);
  e.next();
});

// 1.8.4: too many wrong passwords for one address → refused for a while (the same for unknown addresses)
onRecordAuthWithPasswordRequest((e) => {
  require(`${__hooks}/lib/guard.js`).loginAttempt(e);
}, 'users');

// 1.8.4: every deleted account (by the player, the administrator or the cleanup) is noted outside the
// database, so a restored older backup cannot bring it back (see lib/guard.js, «deletions»)
onRecordAfterDeleteSuccess((e) => {
  try {
    require(`${__hooks}/lib/guard.js`).noteDeletion(e.app, e.record.id);
  } catch (err) {
    e.app.logger().error('prime: could not note a deleted account', 'error', String(err).slice(0, 200));
  }
  e.next();
}, 'users');

// 1.8.4: at every start of the server — accounts deleted earlier but back from a restored backup go
// again; and the journal says plainly what this server's registration really is. (The JS hooks have no
// «serve» event: the bootstrap of `pocketbase serve` is used; console commands skip this.)
onBootstrap((e) => {
  e.next();
  if ($os.args.indexOf('serve') < 0) return;
  const guard = require(`${__hooks}/lib/guard.js`);
  const prime = require(`${__hooks}/lib/prime.js`);
  try {
    guard.reapplyDeletions(e.app);
  } catch (err) {
    console.log('PRIME WARNING: deletions check failed: ' + String(err).slice(0, 200));
  }
  const asked = String($os.getenv('PRIME_REGISTRATION') || '').trim();
  // (console: these lines reach the service journal — `journalctl -u pocketbase`)
  if (asked === 'public' && prime.mode() !== 'public') console.log('PRIME WARNING: PRIME_REGISTRATION=public needs email (PRIME_MAIL_MODE=smtp) — registration stays CLOSED');
  console.log('PRIME: registration ' + prime.mode() + ', email ' + prime.mailMode() + ', proof of work ' + guard.powBits() + ' bits');
});

// 1.8.4: hourly cleanup — counters, spent challenges, never-confirmed 1.8.4 registrations (lib/guard.js)
cronAdd('prime_cleanup', '23 * * * *', () => {
  require(`${__hooks}/lib/guard.js`).cleanup($app);
});

// 1.8.2: the server's settings (API address, email, reverse proxy) from its environment, at every start
onBootstrap((e) => {
  e.next();
  require(`${__hooks}/lib/settings.js`).applyEnv(e.app);
});

// 1.8.2: `pocketbase invites create|list|stats|revoke …` — the administrator's tool (see lib/invites.js)
$app.rootCmd.addCommand(
  new Command({
    use: 'invites',
    short: 'PRIME NETWORK invites: create [N] [days=14] [uses=1] [note=…] | list [all] | stats | revoke <id|code>',
    run: (cmd, args) => {
      require(`${__hooks}/lib/invites.js`).cli($app, args);
    },
  }),
);

// 1.8.4: `pocketbase prime-cleanup` — the hourly cleanup by hand (the administrator; the checks)
$app.rootCmd.addCommand(
  new Command({
    use: 'prime-cleanup',
    short: 'PRIME NETWORK: delete old limit counters, spent challenges and never-confirmed 1.8.4 registrations now',
    run: (cmd, args) => {
      require(`${__hooks}/lib/guard.js`).cleanup($app);
      console.log('OK: cleanup done');
    },
  }),
);
