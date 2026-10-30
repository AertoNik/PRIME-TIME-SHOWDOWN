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
//   1.8.8 stage 3 «PRIME CHECKOUT» (lib/checkout.js, lib/shop_rules.js):
//   GET  /api/prime/shop/offer      the PRIME SHOP offer revision in force (null until one is published)
//   GET  /api/prime/shop/status     the account and the shop: documents, offer accepted?, sales, payments
//   POST /api/prime/shop/offer/accept  accept the current offer revision (a consents row written here)
//   POST /api/prime/shop/checkout   the server's own checks before an order; stage 4: then the order and the
//                                   Robokassa payment page (only when payments are configured)
//   1.8.8 stage 4 «PRIME PAYMENTS × ROBOKASSA» (lib/payments.js, lib/robokassa.js):
//   GET  /api/prime/shop/orders/{inv}       the signed-in account's own order (its state, delivered or not)
//   GET  /api/prime/shop/purchases          the items this PRIME ID owns and its latest orders
//   GET  /api/prime/daily                  1.8.9 DAILY PRIME STREAK: the streak today (verified PRIME ID)
//   POST /api/prime/daily/claim            today's reward — the server pays it into the cloud save (lib/daily.js)
//   POST|GET /api/prime/pay/robokassa/result    Robokassa's ResultURL: signature, order, amount → delivery, «OK{InvId}»
//   GET|POST /api/prime/pay/robokassa/success   SuccessURL: back to the game (proves nothing)
//   GET|POST /api/prime/pay/robokassa/fail      FailURL: back to the game (proves nothing)
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

// 1.8.8 stage 3 «PRIME CHECKOUT»: the offer, the consent to it and the server's own checks before an order
// (no order, no payment and no item is ever created here in stage 3 — see lib/checkout.js)
// Alpha 1.8.9 — DAILY PRIME STREAK: the streak as the server sees it today, and today's reward (written into the
// cloud save by the server; the game names nothing but its request id and the save revision it is in step with)
routerAdd('GET', '/api/prime/daily', (e) => require(`${__hooks}/lib/daily.js`).status(e), $apis.requireAuth('users'));

routerAdd('POST', '/api/prime/daily/claim', (e) => require(`${__hooks}/lib/daily.js`).claim(e), $apis.requireAuth('users'), $apis.bodyLimit(2 * 1024));

routerAdd('GET', '/api/prime/shop/offer', (e) => require(`${__hooks}/lib/checkout.js`).offer(e));

routerAdd('GET', '/api/prime/shop/status', (e) => require(`${__hooks}/lib/checkout.js`).status(e), $apis.requireAuth('users'));

routerAdd('POST', '/api/prime/shop/offer/accept', (e) => require(`${__hooks}/lib/checkout.js`).acceptOffer(e), $apis.requireAuth('users'), $apis.bodyLimit(2 * 1024));

routerAdd('POST', '/api/prime/shop/checkout', (e) => require(`${__hooks}/lib/checkout.js`).checkout(e), $apis.requireAuth('users'), $apis.bodyLimit(2 * 1024));

// 1.8.8 stage 4 «PRIME PAYMENTS × ROBOKASSA»: the player's orders and rights; Robokassa's notification and the
// two return pages (no session there: Robokassa's server and a redirected browser — the signature decides)
routerAdd('GET', '/api/prime/shop/orders/{inv}', (e) => require(`${__hooks}/lib/payments.js`).orderStatus(e), $apis.requireAuth('users'));

routerAdd('GET', '/api/prime/shop/purchases', (e) => require(`${__hooks}/lib/payments.js`).purchases(e), $apis.requireAuth('users'));

routerAdd('POST', '/api/prime/pay/robokassa/result', (e) => require(`${__hooks}/lib/payments.js`).result(e), $apis.bodyLimit(16 * 1024));

routerAdd('GET', '/api/prime/pay/robokassa/result', (e) => require(`${__hooks}/lib/payments.js`).result(e));

routerAdd('GET', '/api/prime/pay/robokassa/success', (e) => require(`${__hooks}/lib/payments.js`).back(e, 'success'));

routerAdd('POST', '/api/prime/pay/robokassa/success', (e) => require(`${__hooks}/lib/payments.js`).back(e, 'success'), $apis.bodyLimit(16 * 1024));

routerAdd('GET', '/api/prime/pay/robokassa/fail', (e) => require(`${__hooks}/lib/payments.js`).back(e, 'fail'));

routerAdd('POST', '/api/prime/pay/robokassa/fail', (e) => require(`${__hooks}/lib/payments.js`).back(e, 'fail'), $apis.bodyLimit(16 * 1024));

// 1.8.2: a server without email (no PRIME_MAIL_MODE=smtp, no local catcher) answers PocketBase's own
// verification / password-reset / email-change requests with 503 «mail_unavailable» — for every address
// Alpha 1.9.0 — PRIME LEAGUE (lib/league.js; off unless PRIME_LEAGUE=on — every route answers 404 league_off).
// Each handler requires its module itself: PocketBase runs handlers in pooled VMs without this file's top-level names.
routerAdd('GET', '/api/prime/league/me', (e) => require(`${__hooks}/lib/league.js`).me(e), $apis.requireAuth('users'));
routerAdd('POST', '/api/prime/league/join', (e) => require(`${__hooks}/lib/league.js`).join(e), $apis.requireAuth('users'), $apis.bodyLimit(2 * 1024));
routerAdd('PUT', '/api/prime/league/defense', (e) => require(`${__hooks}/lib/league.js`).putDefense(e), $apis.requireAuth('users'), $apis.bodyLimit(8 * 1024));
routerAdd('PUT', '/api/prime/league/deck', (e) => require(`${__hooks}/lib/league.js`).putDeck(e), $apis.requireAuth('users'), $apis.bodyLimit(2 * 1024));
routerAdd('POST', '/api/prime/league/defense/toggle', (e) => require(`${__hooks}/lib/league.js`).toggleDefense(e), $apis.requireAuth('users'), $apis.bodyLimit(1024));
routerAdd('POST', '/api/prime/league/report/seen', (e) => require(`${__hooks}/lib/league.js`).reportSeen(e), $apis.requireAuth('users'), $apis.bodyLimit(1024));
routerAdd('POST', '/api/prime/league/match/start', (e) => require(`${__hooks}/lib/league.js`).start(e), $apis.requireAuth('users'), $apis.bodyLimit(4 * 1024));
routerAdd('GET', '/api/prime/league/match/{id}', (e) => require(`${__hooks}/lib/league.js`).getMatch(e), $apis.requireAuth('users'));
routerAdd('POST', '/api/prime/league/match/{id}/inputs', (e) => require(`${__hooks}/lib/league.js`).checkpoint(e), $apis.requireAuth('users'), $apis.bodyLimit(16 * 1024));
routerAdd('POST', '/api/prime/league/match/{id}/finish', (e) => require(`${__hooks}/lib/league.js`).finish(e), $apis.requireAuth('users'), $apis.bodyLimit(16 * 1024));
routerAdd('GET', '/api/prime/league/board', (e) => require(`${__hooks}/lib/league.js`).board(e), $apis.requireAuth('users'));
routerAdd('GET', '/api/prime/league/history', (e) => require(`${__hooks}/lib/league.js`).history(e), $apis.requireAuth('users'));
routerAdd('POST', '/api/prime/league/track/claim', (e) => require(`${__hooks}/lib/league.js`).claimTier(e), $apis.requireAuth('users'), $apis.bodyLimit(1024));
routerAdd('POST', '/api/prime/league/upgrade', (e) => require(`${__hooks}/lib/league.js`).upgrade(e), $apis.requireAuth('users'), $apis.bodyLimit(1024));
routerAdd('POST', '/api/prime/league/series/start', (e) => require(`${__hooks}/lib/league_series.js`).start(e), $apis.requireAuth('users'), $apis.bodyLimit(4 * 1024));
routerAdd('POST', '/api/prime/league/series/next', (e) => require(`${__hooks}/lib/league_series.js`).next(e), $apis.requireAuth('users'), $apis.bodyLimit(1024));
routerAdd('POST', '/api/prime/league/series/abandon', (e) => require(`${__hooks}/lib/league_series.js`).abandon(e), $apis.requireAuth('users'), $apis.bodyLimit(1024));

// Alpha 1.9.0 — PRIME PRODUCER AVATARS (lib/producer.js): the signed-in account's own look; cosmetic only
routerAdd('GET', '/api/prime/producer', (e) => require(`${__hooks}/lib/producer.js`).get(e), $apis.requireAuth('users'));
routerAdd('POST', '/api/prime/producer', (e) => require(`${__hooks}/lib/producer.js`).put(e), $apis.requireAuth('users'), $apis.bodyLimit(1024));

cronAdd('prime_league', '*/2 * * * *', () => {
  require(`${__hooks}/lib/league.js`).expire($app);
});

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

// 1.8.8 stage 4: a deleted PRIME ID (any way) closes its open orders and leaves every order without the link to
// the person (the financial record stays); its rights go with it (cascade) — see lib/payments.js
onRecordDelete((e) => {
  require(`${__hooks}/lib/payments.js`).detachAccount(e.app, e.record.id);
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
  // 1.8.8 stage 4: what this server takes (never a secret value) — and a payment recorded before a restart
  // but not delivered yet is delivered now
  try {
    const pay = require(`${__hooks}/lib/payments.js`);
    const c = pay.publicConfig();
    console.log('PRIME: server role ' + c.role + ', payments ' + (c.ready ? c.env + ' (Robokassa, ' + c.algorithm + ')' : 'off' + (c.problem && c.problem !== 'off' ? ' — ' + c.problem : '')) + ', rights counted: ' + c.counted);
    // 1.8.8: where invoice numbers are reserved, and where the payment pages send players back
    console.log('PRIME: invoice ledger ' + c.ledger + '; game address ' + c.gameUrl);
    // 1.8.8 final: the demonstration (Robokassa's test mode, its own demo rights) and the relay of staging's invoices
    if (c.ready && c.env === 'demo') console.log('PRIME: DEMONSTRATION payments (Robokassa TEST mode, no money moves, demo rights counted) until ' + c.demoUntil);
    if (c.ready && c.env === 'live' && /receipt_required_for_live/.test(c.receipt)) console.log('PRIME WARNING: LIVE payments without ROBOKASSA_RECEIPT=on — new orders are refused (receipt_required_for_live)');
    if (c.relay !== 'off') console.log('PRIME: test-range Robokassa notifications and returns are passed on to ' + c.relay);
    if (/^(INVALID|missing)/.test(c.gameUrl) && c.ready) console.log('PRIME WARNING: PRIME_GAME_URL is ' + c.gameUrl + ' — after paying, players see the return page instead of the game');
    pay.maintain(e.app);
    // a restored older pb_data: payments and refunds it lost come back from the ledger
    pay.recover(e.app);
  } catch (err) {
    console.log('PRIME WARNING: payments check failed: ' + String(err).slice(0, 200));
  }
});

// 1.8.4: hourly cleanup — counters, spent challenges, never-confirmed 1.8.4 registrations (lib/guard.js)
cronAdd('prime_cleanup', '23 * * * *', () => {
  require(`${__hooks}/lib/guard.js`).cleanup($app);
});

// 1.8.8 stage 4: every five minutes — deliver paid orders, close expired ones, ask Robokassa about silent live
// orders (OpStateExt), follow refunds (lib/payments.js)
cronAdd('prime_payments', '*/5 * * * *', () => {
  require(`${__hooks}/lib/payments.js`).maintain($app);
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

// 1.8.8 stage 4: `pocketbase prime-shop …` — orders, reviews and refunds by the administrator (lib/payments.js)
$app.rootCmd.addCommand(
  new Command({
    use: 'prime-shop',
    short: 'PRIME SHOP orders: status | selftest | orders [N] | order <InvId> | reconcile [InvId] | deliver | cancel | review | refund | refund-done | refund-failed | refund-check',
    run: (cmd, args) => {
      require(`${__hooks}/lib/payments.js`).cli($app, args);
    },
  }),
);
