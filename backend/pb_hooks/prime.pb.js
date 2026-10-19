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
//   PUT  /api/prime/save            write the cloud save (owner = you, confirmed email, revision check,
//                                   history copy, idempotent by op) — the only way to change a save
//   POST /api/prime/save/archive    keep this device's version in the history (conflict «use the cloud»)
//   POST /api/prime/save/restore    put a history copy back as a NEW revision
//
// Reading the save and the history uses the generic records API, limited by the collection rules to
// the owner (see pb_migrations).

routerAdd('GET', '/api/prime/config', (e) => require(`${__hooks}/lib/prime.js`).config(e));

routerAdd('POST', '/api/prime/register', (e) => require(`${__hooks}/lib/prime.js`).register(e), $apis.bodyLimit(8 * 1024));

routerAdd('GET', '/api/prime/me', (e) => require(`${__hooks}/lib/prime.js`).me(e), $apis.requireAuth('users'));

routerAdd('PUT', '/api/prime/save', (e) => require(`${__hooks}/lib/prime.js`).putSave(e), $apis.requireAuth('users'), $apis.bodyLimit(720 * 1024));

routerAdd('POST', '/api/prime/save/archive', (e) => require(`${__hooks}/lib/prime.js`).archiveSave(e), $apis.requireAuth('users'), $apis.bodyLimit(720 * 1024));

routerAdd('POST', '/api/prime/save/restore', (e) => require(`${__hooks}/lib/prime.js`).restoreSave(e), $apis.requireAuth('users'), $apis.bodyLimit(8 * 1024));

// 1.8.2: a server without email (no PRIME_MAIL_MODE=smtp, no local catcher) answers PocketBase's own
// verification / password-reset / email-change requests with 503 «mail_unavailable» — for every address
routerUse((e) => {
  if (e.request.method !== 'POST' || !/\/request-(verification|password-reset|email-change)$/.test(e.request.url.path)) return e.next();
  return require(`${__hooks}/lib/prime.js`).blockMailRequests(e);
});

// every outgoing email: only to the SMTP catcher on this computer, unless the server enables real
// email explicitly (PRIME_MAIL_MODE=smtp); none at all on a server without email
onMailerSend((e) => {
  require(`${__hooks}/lib/prime.js`).guardMail(e);
  e.next();
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
