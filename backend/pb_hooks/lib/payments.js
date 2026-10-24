// PRIME TIME: SHOWDOWN — Alpha 1.8.8 stage 4 «PRIME PAYMENTS × ROBOKASSA»: orders, Robokassa, delivery.
// Loaded with require() inside every handler (PocketBase runs each handler in its own JS context).
//
// The whole money path is the server's; the game only shows it:
//   checkout (lib/checkout.js, after every check)  → startOrder(): ONE open order per account, item and payment
//       environment (a unique index); the amount from shop_rules.js in kopecks, fixed in the order; the payment
//       page's fields signed here (Password#1 never leaves the server). A repeated «buy» gets the SAME order
//       (the same InvId — Robokassa never takes two payments for one InvId).
//   the player pays on Robokassa's own page (no card data ever reaches PRIME NETWORK)
//   ResultURL  → result(): the signature (Password#2), the order, its environment, its amount, its Shp_order —
//       then in ONE transaction: paid + the right + fulfilled + the audit trail; «OK{InvId}» only after that
//       commit. A repeated notification finds the order delivered and changes nothing. Should the delivery step
//       fail, the payment alone is kept (its own transaction) and delivered later (maintain(), the order page).
//   SuccessURL / FailURL → back(): a redirect to the game, nothing else (the game asks the order's status)
//   the game's list of paid items: purchases() / orderStatus() — from shop_entitlements, never from a save
//
// Environments (docs/PRIME_PAYMENTS.md): PRIME_SERVER_ROLE says what this server is (production | staging |
// dev; missing = production) and PRIME_PAY_MODE what it takes (off | test | live | demo; missing = off).
//   test  only on staging / dev, only the TEST passwords (the live ones must not even be set), IsTest=1
//   live  only on production, only the live passwords (the test ones must not be set)
//   demo  (1.8.8 final) the official site's DEMONSTRATION of the purchase for Robokassa's moderators and every
//         verified PRIME ID: Robokassa's test mode (IsTest=1, only the TEST passwords — never with a live one
//         set), its OWN environment «demo» (orders, rights, ledger and invoice range of its own), the approved
//         prices of the cosmetics only (never a fighter), and a mandatory last day (PRIME_DEMO_UNTIL, at most 92
//         days ahead). Its rights count only while the demonstration runs; a live server never counts them.
// A production server counts only live rights (demo ones during a demonstration), a staging one only test
// rights: a test payment can never own anything on production. Any doubt about the configuration → no payments
// at all — never a fallback.
//
// One Robokassa shop has ONE set of ResultURL / SuccessURL / FailURL. With them pointed at production, a
// production server passes TEST-range invoices (staging's) on to PRIME_PAY_RELAY_URL untouched — staging
// checks them itself; production never confirms anything for them.
//
// Invoice numbers survive a restored backup (lib/ledger.js): every number is reserved in a ledger OUTSIDE
// pb_data before its payment page is signed, and the next one is the largest of (the database's last + 1),
// (the ledger's mark + 1) and a floor derived from the clock — so an older pb_data, a lost ledger or a clock
// set back cannot alone bring an old number back. Verified payments and refunds are noted in the ledger too:
// after a restore, recover() re-applies them (the item comes back to its buyer, a refund stays a refund), and a
// notification for an order the restored database lost is matched to the ledger. Robokassa's own answer
// (OpStateExt) counts only if it carries THIS order's Shp_order and is not older than the order.

const R = require('./shop_rules.js');
const RK = require('./robokassa.js');
const LEDGER = require('./ledger.js');

/** An open order is reused this long; Robokassa's page closes then too (ExpirationDate). */
const ORDER_TTL_MS = 2 * 3600 * 1000;
/** An expired order is closed this long after its time (a page opened at the last minute may still pay). */
const EXPIRE_GRACE_MS = 15 * 60 * 1000;
/** New orders per account per hour (a reused order does not count). */
const ORDERS_PER_HOUR = 20;
/**
 * Invoice numbers (1.8.8 final): live 10 000 000 000 + 10 × seconds since 2026-01-01 (11 digits for centuries),
 * test 500 000 000 000 000 + the same (15 digits) — disjoint ranges, above every number of the first stage-4
 * scheme (live 1 000 001…, test 900 000 001…), below PocketBase's field limit and JavaScript's exact integers.
 */
const INV_SCHEME = { epoch: Date.UTC(2026, 0, 1), step: 10, base: { live: 10000000000, test: 500000000000000, demo: 700000000000000 } };
/** The longest demonstration one setting may open (PRIME_DEMO_UNTIL): it must be renewed on purpose. */
const DEMO_MAX_DAYS = 92;
/** OpStateExt for one order at most this often when a player asks (the cron asks every 10 minutes). */
const RECHECK_MS = 30 * 1000;
const SECRET_MIN = 8;
const INV_RE = /^[1-9][0-9]{0,14}$/;

const ST = {
  PENDING: 'pending_payment',
  PAID: 'paid',
  FULFILLED: 'fulfilled',
  FAILED: 'failed',
  EXPIRED: 'expired',
  CANCELED: 'canceled',
  REFUND_PENDING: 'refund_pending',
  REFUNDED: 'refunded',
  REVIEW: 'requires_review',
};

/**
 * The only state changes the code may make. A verified payment may reopen a closed order (expired / canceled
 * / failed → paid: the money was taken); nothing ever goes back to «pending_payment», nothing leaves
 * «refunded», and «paid» is reached only from a verified notification (ResultURL / OpStateExt).
 */
const NEXT = {
  pending_payment: ['paid', 'failed', 'expired', 'canceled'],
  paid: ['fulfilled', 'requires_review', 'refund_pending'],
  fulfilled: ['refund_pending'],
  failed: ['paid'],
  expired: ['paid'],
  canceled: ['paid'],
  requires_review: ['fulfilled', 'refund_pending'],
  refund_pending: ['refunded', 'fulfilled', 'requires_review'],
  refunded: [],
};

const HASH = {
  md5: (s) => $security.md5(s),
  sha256: (s) => $security.sha256(s),
  sha512: (s) => $security.sha512(s),
};

function env(k) {
  return String($os.getenv(k) || '').trim();
}

/** The smallest invoice number the clock allows now (never below the environment's base). */
function invFloor(envName, now) {
  const secs = Math.max(0, Math.floor((now - INV_SCHEME.epoch) / 1000));
  return INV_SCHEME.base[envName] + secs * INV_SCHEME.step;
}

/**
 * The environment an invoice number belongs to, by its range alone (before any signature is checked): demo from
 * 700 000 000 000 000, test from 500 000 000 000 000, live from 10 000 000 000; the first stage-4 scheme had
 * test 900 000 001… and live 1 000 001….
 */
function envOfInv(inv) {
  const n = Number(inv);
  if (!Number.isSafeInteger(n) || n < 1) return '';
  if (n >= INV_SCHEME.base.demo) return 'demo';
  if (n >= INV_SCHEME.base.test) return 'test';
  if (n >= INV_SCHEME.base.live) return 'live';
  return n > 900000000 ? 'test' : 'live';
}

/** The next invoice number: above the database, above the ledger, not below the clock's floor. */
function pickInv(envName, dbLast, ledgerMark, now) {
  return Math.max((dbLast || 0) + 1, (ledgerMark || 0) + 1, invFloor(envName, now));
}

function findOne(app, collection, filter, params) {
  try {
    return app.findFirstRecordByFilter(collection, filter, params || {});
  } catch (_) {
    return null;
  }
}

function find(app, collection, filter, sort, limit, params) {
  try {
    return app.findRecordsByFilter(collection, filter, sort, limit, 0, params || {}) || [];
  } catch (_) {
    return [];
  }
}

function fail(e, status, code, extra) {
  const out = { code: code };
  if (extra) for (const k of Object.keys(extra)) out[k] = extra[k];
  return e.json(status, out);
}

// ------------------------------------------------------------ configuration
/** What this server is: production (the default — the safe reading of a missing setting), staging or dev. */
function role() {
  const r = env('PRIME_SERVER_ROLE');
  return r === 'staging' || r === 'dev' ? r : 'production';
}

/**
 * The rights this server counts: live on production, test on staging / dev — whatever is in the database. A
 * running demonstration (PRIME_PAY_MODE=demo, fully set up, before its last day) counts its own demo rights
 * instead; the moment it ends (or live payments start) they count for nothing again.
 */
function countedEnv() {
  const c = config();
  if (c.ready && c.env === 'demo') return 'demo';
  return role() === 'production' ? 'live' : 'test';
}

/**
 * PRIME_DEMO_UNTIL — the demonstration's last day (YYYY-MM-DD, Moscow time): { until (ms, end of that day), day }
 * or { problem }. Mandatory, in the future, at most DEMO_MAX_DAYS ahead.
 */
function demoWindow(now) {
  const raw = env('PRIME_DEMO_UNTIL');
  if (!raw) return { problem: 'demo_until_missing' };
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(raw)) return { problem: 'demo_until_invalid' };
  const start = Date.parse(raw + 'T00:00:00+03:00');
  if (!isFinite(start) || new Date(start + 3 * 3600000).toISOString().slice(0, 10) !== raw) return { problem: 'demo_until_invalid' };
  const until = start + 86400000;
  if (until <= now) return { problem: 'demo_expired' };
  if (until - now > DEMO_MAX_DAYS * 86400000) return { problem: 'demo_until_too_far' };
  return { until: until, day: raw };
}

/**
 * The payment configuration, or why there is none. Holds the passwords — never returned to a client, never
 * logged (publicConfig() is the printable view).
 */
function config() {
  const mode = env('PRIME_PAY_MODE');
  const r = role();
  const off = (problem) => ({ ready: false, env: null, role: r, mode: mode || 'off', problem: problem });
  if (mode === '' || mode === 'off') return off('off');
  if (mode !== 'test' && mode !== 'live' && mode !== 'demo') return off('mode_unknown');
  if (mode === 'test' && r === 'production') return off('test_on_production');
  if (mode === 'live' && r !== 'production') return off('live_outside_production');
  // the demonstration: Robokassa's test mode under its own name, never open-ended
  let demo = null;
  if (mode === 'demo') {
    demo = demoWindow(Date.now());
    if (demo.problem) return off(demo.problem);
  }
  const login = env('ROBOKASSA_MERCHANT_LOGIN');
  if (!/^[A-Za-z0-9_.-]{2,64}$/.test(login)) return off('merchant_login_missing');
  const alg = env('ROBOKASSA_HASH_ALGORITHM').toLowerCase();
  if (!alg) return off('algorithm_missing');
  if (RK.ALGORITHMS.indexOf(alg) < 0) return off('algorithm_unsupported');
  const liveSet = ['ROBOKASSA_PASSWORD_1', 'ROBOKASSA_PASSWORD_2', 'ROBOKASSA_PASSWORD_3'].some((k) => env(k) !== '');
  const testSet = ['ROBOKASSA_TEST_PASSWORD_1', 'ROBOKASSA_TEST_PASSWORD_2'].some((k) => env(k) !== '');
  let p1 = '';
  let p2 = '';
  let p3 = '';
  if (mode === 'test' || mode === 'demo') {
    // a test (or demonstration) server must not even hold the live passwords: it can only ever sign test pages
    if (liveSet) return off(mode === 'test' ? 'live_secrets_on_test_server' : 'live_secrets_on_demo_server');
    p1 = env('ROBOKASSA_TEST_PASSWORD_1');
    p2 = env('ROBOKASSA_TEST_PASSWORD_2');
  } else {
    if (testSet) return off('test_secrets_on_live_server');
    p1 = env('ROBOKASSA_PASSWORD_1');
    p2 = env('ROBOKASSA_PASSWORD_2');
    p3 = env('ROBOKASSA_PASSWORD_3');
  }
  if (p1.length < SECRET_MIN || p2.length < SECRET_MIN) return off('passwords_missing');
  if (p1 === p2) return off('passwords_equal');
  // the invoice ledger must be readable: without it no number can be reserved safely (lib/ledger.js)
  try {
    LEDGER.mark($app, mode);
  } catch (_) {
    return off('ledger_unavailable');
  }
  // development only (a local emulator of the payment page for the UI checks): never on staging / production
  const dev = env('PRIME_PAY_DEV_GATEWAY');
  const gateway = r === 'dev' && /^http:\/\/127\.0\.0\.1:[0-9]{2,5}\/[A-Za-z0-9_\/.-]*$/.test(dev) ? dev : RK.PAY_URL;
  return {
    ready: true,
    env: mode,
    role: r,
    mode: mode,
    problem: null,
    // Robokassa's test mode (IsTest=1, the test passwords): staging tests and the demonstration
    test: mode !== 'live',
    demoUntil: demo ? demo.until : 0,
    demoDay: demo ? demo.day : '',
    login: login,
    alg: alg,
    p1: p1,
    p2: p2,
    p3: p3,
    gateway: gateway,
    receipt: env('ROBOKASSA_RECEIPT') === 'on',
    refundApi: mode === 'live' && p3.length >= SECRET_MIN && env('PRIME_PAY_REFUND_API') === 'on',
  };
}

/** The configuration without a single secret (the console command, the start log). */
function publicConfig() {
  const c = config();
  return {
    role: c.role,
    mode: c.mode,
    ready: c.ready,
    problem: c.problem,
    env: c.env,
    counted: countedEnv(),
    merchant: c.ready ? c.login : env('ROBOKASSA_MERCHANT_LOGIN') ? 'set' : 'missing',
    algorithm: c.ready ? c.alg : env('ROBOKASSA_HASH_ALGORITHM') || 'missing',
    gateway: c.ready ? (c.gateway === RK.PAY_URL ? 'robokassa' : 'local emulator (dev)') : '-',
    receipt: c.ready ? c.receipt : false,
    refundApi: c.ready ? c.refundApi : false,
    resultIps: env('ROBOKASSA_RESULT_IPS') ? 'restricted' : 'any (signature checked)',
    demoUntil: c.ready && c.env === 'demo' ? c.demoDay + ' (Moscow time, inclusive)' : env('PRIME_DEMO_UNTIL') ? env('PRIME_DEMO_UNTIL') + ' (not active)' : '-',
    relay: relayBase() ? relayBase() + ' (test-range invoices' + (role() === 'production' ? ')' : ', ignored: not a production server)') : 'off',
    gameUrl: gameUrl() ? gameUrl() : env('PRIME_GAME_URL') ? 'INVALID (' + env('PRIME_GAME_URL').slice(0, 80) + ')' : 'missing',
    ledger: (function () {
      const h = LEDGER.health($app, countedEnv());
      return h.ok ? 'ok (' + h.dir + ', mark ' + LEDGER.mark($app, countedEnv()) + ')' : 'UNAVAILABLE — ' + h.problem;
    })(),
  };
}

/** The rules this server sells by: test (staging) or demo while that mode runs, else the real ones. */
function shopEnv(cfg) {
  const c = cfg || config();
  return c.ready && (c.env === 'test' || c.env === 'demo') ? c.env : 'live';
}

/** Roubles → whole kopecks, exactly (the same rule as src/config/shop.config.ts rubToKop). */
function rubToKop(rub) {
  if (typeof rub !== 'number' || !isFinite(rub) || rub <= 0) return null;
  const kop = Math.round(rub * 100);
  return Math.abs(kop - rub * 100) < 1e-6 && kop <= RK.MAX_KOP ? kop : null;
}

/**
 * The amount charged for `sku` in kopecks in that environment (null: not for sale there). live and demo — the
 * owner's APPROVED price (a demonstration shows the real price; Robokassa's test mode moves no money); test —
 * the staging block (10 ₽). A fighter is never sold in a demonstration (it is not cosmetic).
 */
function priceKop(sku, envName) {
  if (envName === 'demo' && R.catalog[sku] && R.catalog[sku].kind === 'fighter') return null;
  const src = envName === 'test' ? (R.test && R.test.prices) || {} : R.prices || {};
  return Object.prototype.hasOwnProperty.call(src, sku) ? rubToKop(src[sku]) : null;
}

function pricesFor(envName) {
  const out = {};
  for (const sku of Object.keys(R.catalog)) out[sku] = priceKop(sku, envName);
  return out;
}

/** The item's OFFICIAL price (approved by the owner; null: not approved) — what the catalog shows everywhere. */
function listPrices() {
  const out = {};
  for (const sku of Object.keys(R.catalog)) out[sku] = Object.prototype.hasOwnProperty.call(R.prices || {}, sku) ? rubToKop(R.prices[sku]) : null;
  return out;
}

/**
 * Sales: live — the release's flag AND PRIME_SHOP_SALES=open; test and demo — this server's PRIME_SHOP_SALES=open
 * (the release's flag is about real money only).
 */
function salesOpen(cfg) {
  const c = cfg || config();
  const server = env('PRIME_SHOP_SALES') === 'open';
  if (shopEnv(c) !== 'live') return server;
  return R.salesOpen === true && server;
}

// ------------------------------------------------------------ ownership
function activeRight(app, uid, sku, envName) {
  return findOne(app, 'shop_entitlements', 'user = {:u} && sku = {:s} && env = {:e} && status = "active"', { u: uid, s: sku, e: envName });
}

/** The skus this account owns through PRIME SHOP (active rights of the counted environment). */
function ownedSkus(app, uid) {
  const out = [];
  for (const r of find(app, 'shop_entitlements', 'user = {:u} && env = {:e} && status = "active"', 'created', 100, { u: uid, e: countedEnv() })) {
    const s = r.getString('sku');
    if (out.indexOf(s) < 0) out.push(s);
  }
  return out;
}

/**
 * Fighters this account has (or had) a paid right to — the save check lets such a fighter be «selected»
 * without being opened in the save (the purchase is never written into a save). A revoked right still counts
 * here, so a refund never breaks the next cloud save; the game moves the selection itself.
 */
function paidFighters(app, uid) {
  const out = [];
  for (const r of find(app, 'shop_entitlements', 'user = {:u} && env = {:e} && kind = "fighter"', 'created', 20, { u: uid, e: countedEnv() })) {
    const f = r.getString('item');
    if (out.indexOf(f) < 0) out.push(f);
  }
  return out;
}

/** A seasonal star already opened in this account's cloud save (for the event's tokens). */
function fighterUnlocked(app, uid, fighter) {
  try {
    const s = app.findFirstRecordByFilter('saves', 'owner = {:u}', { u: uid });
    const d = JSON.parse(s.getString('data'));
    return !!(d && d.fighters && d.fighters[fighter] && d.fighters[fighter].unlocked === true);
  } catch (_) {
    return false;
  }
}

// ------------------------------------------------------------ the audit trail
/** One row of shop_payment_events (never a password, a secret, an email or card data). */
function event(app, o, kind, code, detail, inv, envName) {
  const r = new Record(app.findCollectionByNameOrId('shop_payment_events'));
  if (o) {
    r.set('order', o.id);
    r.set('invId', o.getInt('invId'));
    r.set('env', o.getString('env'));
  } else {
    r.set('invId', inv || 0);
    r.set('env', envName || '');
  }
  r.set('kind', kind);
  r.set('code', String(code || '').slice(0, 48));
  r.set('detail', String(detail || '').slice(0, 500));
  app.save(r);
}

/** One allowed state change (anything else throws — nothing is half-written inside a transaction). */
function move(app, o, to, set) {
  const from = o.getString('status');
  if (!NEXT[from] || NEXT[from].indexOf(to) < 0) throw new Error('prime-pay: refused transition ' + from + ' -> ' + to);
  o.set('status', to);
  if (set) for (const k of Object.keys(set)) o.set(k, set[k]);
  app.save(o);
}

/** What a player may see of an order (no internal fields). */
function orderOut(o) {
  return {
    inv: o.getInt('invId'),
    sku: o.getString('sku'),
    title: o.getString('title'),
    amountKop: o.getInt('amountKop'),
    currency: o.getString('currency') || 'RUB',
    status: o.getString('status'),
    env: o.getString('env'),
    created: o.getString('created'),
    expiresAt: o.getInt('expiresAt'),
    paidAt: o.getInt('paidAt'),
    fulfilledAt: o.getInt('fulfilledAt'),
  };
}

/** What the buyer pays for, as Robokassa's Description and the receipt name («Цифровой облик бойца … для игры …»). */
function receiptName(sku) {
  const n = R.receiptNames && R.receiptNames[sku];
  return String(n || 'PRIME TIME SHOWDOWN: ' + ((R.titles && R.titles[sku]) || sku)).slice(0, 100);
}

function paymentFor(o, cfg) {
  const title = o.getString('title');
  // (orders of the first stage-4 build kept the bare item name)
  const desc = /PRIME TIME/.test(title) ? title : 'PRIME TIME SHOWDOWN: ' + title;
  return RK.paymentForm({
    login: cfg.login,
    password1: cfg.p1,
    alg: cfg.alg,
    H: HASH,
    kop: o.getInt('amountKop'),
    inv: o.getInt('invId'),
    title: desc,
    test: cfg.test,
    shp: { Shp_order: o.id },
    expires: o.getInt('expiresAt'),
    receipt: cfg.receipt ? RK.receipt(desc, o.getInt('amountKop')) : '',
    gateway: cfg.gateway,
  });
}

/** The next invoice number of `envName` (see INV_SCHEME, pickInv). Throws when the ledger cannot be read. */
function nextInv(app, envName, now) {
  const last = find(app, 'shop_orders', 'env = {:e}', '-invId', 1, { e: envName })[0];
  return pickInv(envName, last ? last.getInt('invId') : 0, LEDGER.mark(app, envName), now);
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

// ------------------------------------------------------------ orders
/**
 * Called by lib/checkout.js once EVERY check passed (item, account, documents, price, sales, offer, consent,
 * payments ready). `it` = the catalog entry; `kop` = the server price; `offer` = the revision accepted.
 * Answers { order, payment: { url, method, fields }, reused }.
 */
function startOrder(e, uid, sku, it, kop, offer, cfg) {
  let out = null;
  try {
    e.app.runInTransaction((tx) => {
      if (activeRight(tx, uid, sku, cfg.env)) {
        out = [409, { code: 'owned' }];
        return;
      }
      const now = Date.now();
      const open = findOne(tx, 'shop_orders', 'user = {:u} && sku = {:s} && env = {:e} && status = "pending_payment"', { u: uid, s: sku, e: cfg.env });
      if (open) {
        // the same item, price and terms, with time left: the SAME order (a double tap, a second tab)
        if (open.getInt('expiresAt') > now + 60000 && open.getInt('amountKop') === kop && open.getInt('offerRevision') === offer.revision) {
          out = [200, { order: orderOut(open), payment: paymentFor(open, cfg), reused: true }];
          return;
        }
        const why = open.getInt('expiresAt') <= now + 60000 ? 'expired' : 'terms_changed';
        move(tx, open, why === 'expired' ? ST.EXPIRED : ST.CANCELED, { note: why });
        event(tx, open, why === 'expired' ? 'expired' : 'canceled', why, 'replaced by a new order');
      }
      const recent = find(tx, 'shop_orders', 'user = {:u} && expiresAt > {:t}', '', ORDERS_PER_HOUR + 1, { u: uid, t: now + ORDER_TTL_MS - 3600000 });
      if (recent.length >= ORDERS_PER_HOUR) {
        out = [429, { code: 'too_many_orders' }];
        return;
      }
      const inv = nextInv(tx, cfg.env, now);
      const id = $security.randomStringWithAlphabet(15, ID_ALPHABET);
      const title = receiptName(sku);
      // the number is reserved OUTSIDE the database first: an older pb_data restored later never hands it out
      // again, and a payment for it can still be matched to this order (throws → no order, no payment page)
      LEDGER.issue(tx, { inv: inv, env: cfg.env, order: id, user: uid, sku: sku, item: it.item, kind: it.kind, kop: kop, offer: offer.revision, offerHash: offer.sha256, title: title, created: now });
      const o = new Record(tx.findCollectionByNameOrId('shop_orders'));
      o.set('id', id);
      o.set('user', uid);
      o.set('invId', inv);
      o.set('env', cfg.env);
      o.set('provider', 'robokassa');
      o.set('sku', sku);
      o.set('item', it.item);
      o.set('kind', it.kind);
      o.set('title', title);
      o.set('amountKop', kop);
      o.set('currency', 'RUB');
      o.set('offerRevision', offer.revision);
      o.set('offerHash', offer.sha256);
      o.set('status', ST.PENDING);
      o.set('hashAlg', cfg.alg);
      o.set('expiresAt', now + ORDER_TTL_MS);
      tx.save(o);
      event(tx, o, 'order_created', sku, 'amount ' + kop + ' kop, offer ' + offer.revision);
      out = [200, { order: orderOut(o), payment: paymentFor(o, cfg), reused: false }];
    });
  } catch (err) {
    // the ledger (or the database) refused: no number was handed out — the purchase waits, nothing is charged
    e.app.logger().error('prime-pay: an order could not be made', 'error', String(err).slice(0, 300));
    return fail(e, 503, /ledger/.test(String(err)) ? 'ledger_unavailable' : 'order_failed');
  }
  return e.json(out[0], out[1]);
}

// ------------------------------------------------------------ delivery
function review(app, o, reason) {
  move(app, o, ST.REVIEW, { reviewReason: reason });
  event(app, o, 'review', reason, '');
  return ST.REVIEW;
}

/**
 * paid → fulfilled (the right is created) or requires_review (it cannot be: the account is gone, the item is
 * owned already — a second payment to refund). Inside the caller's transaction; idempotent per order (the
 * right's unique index on `order`).
 */
function fulfillTx(tx, o) {
  const now = Date.now();
  const uid = o.getString('user');
  const sku = o.getString('sku');
  const envName = o.getString('env');
  if (findOne(tx, 'shop_entitlements', 'order = {:o}', { o: o.id })) {
    move(tx, o, ST.FULFILLED, { fulfilledAt: o.getInt('fulfilledAt') || now });
    return ST.FULFILLED;
  }
  if (!uid) return review(tx, o, 'account_deleted');
  const it = Object.prototype.hasOwnProperty.call(R.catalog, sku) ? R.catalog[sku] : null;
  if (!it) return review(tx, o, 'unknown_item');
  if (activeRight(tx, uid, sku, envName)) return review(tx, o, 'already_owned');
  if (it.kind === 'fighter' && fighterUnlocked(tx, uid, it.item)) return review(tx, o, 'already_owned_season');
  const r = new Record(tx.findCollectionByNameOrId('shop_entitlements'));
  r.set('user', uid);
  r.set('sku', sku);
  r.set('item', it.item);
  r.set('kind', it.kind);
  r.set('order', o.id);
  r.set('source', 'purchase');
  r.set('env', envName);
  r.set('status', 'active');
  r.set('grantedAt', now);
  tx.save(r);
  move(tx, o, ST.FULFILLED, { fulfilledAt: now });
  event(tx, o, 'fulfilled', sku, '');
  return ST.FULFILLED;
}

/**
 * A VERIFIED payment of invoice `inv` (a ResultURL notification whose signature holds, or Robokassa's own
 * OpStateExt answer). Inside the caller's transaction. Returns { status, duplicate } or { code } (refused).
 * info = { sum (the exact OutSum text), fee, method, cur, opKey, shp (Shp_order, '' for OpStateExt) }.
 */
function confirmTx(tx, inv, kop, via, info, cfgEnv) {
  const o = findOne(tx, 'shop_orders', 'invId = {:i}', { i: inv });
  if (!o) return { code: 'unknown_order' };
  if (o.getString('env') !== cfgEnv) return { code: 'env_mismatch', order: o };
  if (via === 'result' && info.shp !== o.id) return { code: 'shp_mismatch', order: o };
  const st = o.getString('status');
  if (st === ST.FULFILLED || st === ST.REFUND_PENDING || st === ST.REFUNDED || st === ST.REVIEW) return { status: st, duplicate: true, order: o };
  if (st === ST.PAID) return { status: fulfillTx(tx, o), duplicate: true, order: o };
  // pending — or closed (expired / canceled / failed): a verified payment is a payment all the same
  move(tx, o, ST.PAID, {
    paidAt: Date.now(),
    paidVia: via,
    paidSum: String(info.sum || '').slice(0, 24),
    fee: String(info.fee || '').slice(0, 24),
    paymentMethod: String(info.method || '').slice(0, 40),
    incCurrLabel: String(info.cur || '').slice(0, 40),
    opKey: String(info.opKey || o.getString('opKey') || '').slice(0, 80),
  });
  event(tx, o, 'paid', via, st === ST.PENDING ? '' : 'late payment: the order was ' + st);
  // the verified payment outside the database too: a restored older pb_data gets it back (recover())
  LEDGER.update(tx, o.getString('env'), inv, { paid: { at: Date.now(), sum: String(info.sum || ''), via: via } });
  if (o.getInt('amountKop') !== kop) return { status: review(tx, o, 'amount_mismatch'), order: o };
  return { status: fulfillTx(tx, o), order: o };
}

/**
 * An order the database does not have, rebuilt from its ledger record (a restored older backup lost it). It is
 * made «canceled» — a closed order a verified payment may still reopen — with the SAME id (= its Shp_order).
 * Its buyer only if that account still exists (a deleted one: the payment goes to review).
 */
function restoreOrderTx(tx, rec) {
  let user = '';
  if (rec.user) {
    try {
      user = tx.findRecordById('users', rec.user).id;
    } catch (_) {
      user = '';
    }
  }
  const o = new Record(tx.findCollectionByNameOrId('shop_orders'));
  o.set('id', rec.order);
  o.set('user', user);
  o.set('invId', rec.inv);
  o.set('env', rec.env);
  o.set('provider', 'robokassa');
  o.set('sku', rec.sku);
  o.set('item', rec.item);
  o.set('kind', rec.kind);
  o.set('title', String(rec.title || '').slice(0, 100));
  o.set('amountKop', rec.kop);
  o.set('currency', 'RUB');
  o.set('offerRevision', rec.offer || 0);
  o.set('offerHash', rec.offerHash || '');
  o.set('status', ST.CANCELED);
  o.set('expiresAt', rec.created + ORDER_TTL_MS);
  o.set('note', 'restored from the invoice ledger');
  tx.save(o);
  event(tx, o, 'restored', 'ledger', 'rebuilt after a restore of the database');
  return o;
}

/** The payment alone (its own transaction) when delivering failed — maintain() / the order page deliver it later. */
function keepPayment(app, inv, kop, via, info, cfgEnv, why) {
  let kept = false;
  app.runInTransaction((tx) => {
    const o = findOne(tx, 'shop_orders', 'invId = {:i}', { i: inv });
    if (!o || o.getString('env') !== cfgEnv || (via === 'result' && info.shp !== o.id)) return;
    const st = o.getString('status');
    if (st !== ST.PENDING && st !== ST.EXPIRED && st !== ST.CANCELED && st !== ST.FAILED) {
      kept = true; // already recorded
      return;
    }
    move(tx, o, ST.PAID, { paidAt: Date.now(), paidVia: via, paidSum: String(info.sum || '').slice(0, 24), fee: String(info.fee || '').slice(0, 24), paymentMethod: String(info.method || '').slice(0, 40), incCurrLabel: String(info.cur || '').slice(0, 40) });
    event(tx, o, 'paid', via, 'delivery postponed: ' + String(why).slice(0, 200));
    LEDGER.update(tx, o.getString('env'), inv, { paid: { at: Date.now(), sum: String(info.sum || ''), via: via } });
    if (o.getInt('amountKop') !== kop) review(tx, o, 'amount_mismatch');
    kept = true;
  });
  return kept;
}

/** Deliver a paid order now (its own transaction); the new status, or null. */
function deliver(app, id) {
  let st = null;
  app.runInTransaction((tx) => {
    const o = tx.findRecordById('shop_orders', id);
    st = o.getString('status') === ST.PAID ? fulfillTx(tx, o) : o.getString('status');
  });
  return st;
}

// ------------------------------------------------------------ ResultURL
/**
 * The notification's parameters exactly as sent — read from the raw text, never through PocketBase's body
 * parsing (that turns «123» into a number and loses the exact OutSum text the signature is made over).
 */
function notificationParams(e) {
  const out = {};
  const ct = String(e.request.header.get('Content-Type') || '').toLowerCase();
  if (ct.indexOf('multipart/') === 0) {
    for (const k of RK.RESULT_FIELDS.concat(['Shp_order'])) {
      let v = '';
      try {
        v = e.request.formValue(k);
      } catch (_) {
        v = '';
      }
      if (typeof v === 'string' && v && v.length <= 2000) out[k] = v;
    }
  } else {
    let raw = '';
    try {
      raw = toString(e.request.body);
    } catch (_) {
      raw = '';
    }
    RK.parseForm(raw, out);
  }
  RK.parseForm(String(e.request.url.rawQuery || ''), out);
  return out;
}

/** Optional: only Robokassa's addresses (ROBOKASSA_RESULT_IPS=185.59.216.65,185.59.217.65). The signature is checked either way. */
function ipAllowed(e) {
  const list = env('ROBOKASSA_RESULT_IPS');
  if (!list) return true;
  const ip = String(e.realIP() || '');
  return list.split(',').map((s) => s.trim()).filter(Boolean).indexOf(ip) >= 0;
}

function refused(app, inv, envName, code, hint) {
  app.logger().warn('prime-pay: notification refused', 'code', code, 'inv', inv, 'hint', hint || '');
  const o = inv ? findOne(app, 'shop_orders', 'invId = {:i}', { i: inv }) : null;
  if (o) {
    try {
      event(app, o, 'result_refused', code, hint || '');
    } catch (_) {
      /* the trail is best effort here: nothing changed */
    }
  }
}

// ------------------------------------------------------------ the relay to staging (one Robokassa shop)
/**
 * PRIME_PAY_RELAY_URL — the staging server that owns the TEST-range invoices: an https origin, or staging on the
 * same machine over loopback (http://127.0.0.1:8091 — never leaves the server). No path. Only a production server
 * relays; '' when unset or malformed.
 */
function relayBase() {
  const u = env('PRIME_PAY_RELAY_URL').replace(/\/+$/, '');
  return /^(https:\/\/[A-Za-z0-9.-]+|http:\/\/(127\.0\.0\.1|localhost))(:[0-9]{1,5})?$/.test(u) ? u : '';
}

/** Where to pass invoice `inv` on ('' = handle it here): a test-range number reaching a production server. */
function relayFor(inv) {
  if (role() !== 'production' || envOfInv(inv) !== 'test') return '';
  return relayBase();
}

/**
 * Pass a notification on to staging untouched (the same fields, POST) and answer Robokassa with staging's own
 * answer («OK…» only if staging confirmed). Production checks nothing, records nothing, grants nothing here.
 */
function relayResult(e, base, p, inv) {
  if (String(e.request.header.get('X-Prime-Relay') || '') !== '') return e.string(508, 'relay loop');
  const body = Object.keys(p)
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(p[k]))
    .join('&');
  try {
    const res = $http.send({ url: base + '/api/prime/pay/robokassa/result', method: 'POST', body: body, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Prime-Relay': '1' }, timeout: 20 });
    const text = String(toString(res.body) || '').slice(0, 80);
    e.app.logger().info('prime-pay: a test-range notification passed on to staging', 'inv', inv, 'status', res.statusCode);
    return e.string(res.statusCode >= 200 && res.statusCode < 600 ? res.statusCode : 502, text);
  } catch (err) {
    e.app.logger().warn('prime-pay: passing a test-range notification on failed — Robokassa will repeat it', 'inv', inv, 'error', String(err).slice(0, 200));
    return e.string(502, 'relay failed');
  }
}

/** POST|GET /api/prime/pay/robokassa/result — Robokassa's ResultURL. */
function result(e) {
  if (!ipAllowed(e)) {
    e.app.logger().warn('prime-pay: a notification from an address not on ROBOKASSA_RESULT_IPS');
    return e.string(403, 'forbidden');
  }
  const p = notificationParams(e);
  const invGuess = INV_RE.test(p.InvId || '') ? Number(p.InvId) : 0;
  // staging's invoice (the shop's addresses point here): staging decides — even while payments are off here
  const relay = relayFor(invGuess);
  if (relay) return relayResult(e, relay, p, invGuess);
  const cfg = config();
  if (!cfg.ready) {
    e.app.logger().warn('prime-pay: a notification while payments are off', 'problem', cfg.problem);
    return e.string(503, 'payments are off');
  }
  const chk = RK.checkResult(p, { password2: cfg.p2, password1: cfg.p1, alg: cfg.alg, H: HASH, equal: (a, b) => $security.equal(a, b), test: cfg.test });
  if (!chk.ok) {
    refused(e.app, invGuess, cfg.env, chk.code, chk.hint);
    return e.string(400, 'bad request');
  }
  const info = { sum: chk.sum, fee: p.Fee || '', method: p.PaymentMethod || '', cur: p.IncCurrLabel || '', opKey: '', shp: chk.shp.Shp_order || '' };
  let res = null;
  try {
    e.app.runInTransaction((tx) => {
      res = confirmTx(tx, chk.inv, chk.kop, 'result', info, cfg.env);
      // a refusal changes nothing — make the transaction write nothing either
      if (res.code) return;
    });
  } catch (err) {
    // delivering failed (the whole transaction is undone): keep at least the payment, deliver it later
    e.app.logger().error('prime-pay: delivery failed, keeping the payment', 'inv', chk.inv, 'error', String(err).slice(0, 300));
    try {
      if (keepPayment(e.app, chk.inv, chk.kop, 'result', info, cfg.env, err)) return e.string(200, 'OK' + chk.invText);
    } catch (err2) {
      e.app.logger().error('prime-pay: could not record a verified payment — Robokassa will repeat it', 'inv', chk.inv, 'error', String(err2).slice(0, 300));
    }
    return e.string(500, 'retry later');
  }
  if (res.code === 'unknown_order') {
    // a valid signature for an invoice this database does not know — a restored older backup? The ledger knows
    // the order (the same id in Shp_order, the same amount): rebuild it and confirm the payment as usual
    const rec = LEDGER.read(e.app, cfg.env, chk.inv);
    if (rec && rec.order === info.shp && rec.kop === chk.kop) {
      try {
        e.app.runInTransaction((tx) => {
          restoreOrderTx(tx, rec);
          const r2 = confirmTx(tx, chk.inv, chk.kop, 'result', info, cfg.env);
          // (a refusal undoes the rebuilt order too)
          if (r2.code) throw new Error('prime: rebuild refused ' + r2.code);
          res = r2;
        });
        if (!res.code) {
          e.app.logger().warn('prime-pay: an order lost by a restored database was rebuilt from the ledger and paid', 'inv', chk.inv, 'status', res.status);
          return e.string(200, 'OK' + chk.invText);
        }
      } catch (err) {
        e.app.logger().error('prime-pay: rebuilding an order from the ledger failed — Robokassa will repeat', 'inv', chk.inv, 'error', String(err).slice(0, 300));
        return e.string(500, 'retry later');
      }
    }
    e.app.logger().error('prime-pay: a verified payment for an unknown order', 'inv', chk.inv);
    if (!findOne(e.app, 'shop_payment_events', 'invId = {:i} && kind = "result_orphan"', { i: chk.inv })) event(e.app, null, 'result_orphan', 'unknown_order', 'OutSum ' + chk.sum, chk.inv, cfg.env);
    return e.string(404, 'unknown order');
  }
  if (res.code) {
    refused(e.app, chk.inv, cfg.env, res.code, '');
    return e.string(400, 'bad request');
  }
  if (res.duplicate) e.app.logger().info('prime-pay: repeated notification', 'inv', chk.inv, 'status', res.status);
  return e.string(200, 'OK' + chk.invText);
}

// ------------------------------------------------------------ SuccessURL / FailURL
/**
 * PRIME_GAME_URL as a safe address of the game, or '' (no redirect then — the return page offers a button):
 * https://… anywhere, http:// only for this computer (localhost, 127.0.0.1, [::1]). «…/» is added when the address
 * has no path or ends in a folder name («https://primetimeshowdown.online» → «…online/», «http://localhost:4173» →
 * «…4173/»); a #fragment is dropped; a ?query is kept.
 */
function normalizeGameUrl(raw) {
  const s = String(raw || '').trim();
  const m = /^(https:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?|http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?)(\/[^\s"'<>\\?#]*)?(\?[^\s"'<>\\#]*)?(#.*)?$/.exec(s);
  if (!m) return '';
  let path = m[2] || '/';
  const last = path.slice(path.lastIndexOf('/') + 1);
  if (last && last.indexOf('.') < 0) path += '/';
  return m[1] + path + (m[3] || '');
}

function gameUrl() {
  return normalizeGameUrl(env('PRIME_GAME_URL'));
}

/** The official game (the safe button of the return page on a production server whose PRIME_GAME_URL is wrong). */
const OFFICIAL_GAME = 'https://primetimeshowdown.online/';

/** The game's address with ?prime_pay=success|fail&inv=N (the game checks that order — it proves nothing). */
function returnUrl(game, kind, inv) {
  return game + (game.indexOf('?') >= 0 ? '&' : '?') + 'prime_pay=' + (kind === 'success' ? 'success' : 'fail') + (inv ? '&inv=' + inv : '');
}

function htmlEsc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/**
 * The return page when no redirect is possible (PRIME_GAME_URL missing or wrong): the PRIME look, what happened
 * in plain words and one clear button back to the game. Never says the purchase is done — the game asks the server.
 */
function returnPage(kind, inv, target) {
  const ok = kind === 'success';
  const title = ok ? 'Проверяем оплату' : 'Оплата не завершена';
  const text = ok
    ? 'Вернитесь в игру: PRIME NETWORK проверит платёж' + (inv ? ' по заказу №' + inv : '') + ', и предмет появится в «Моей коллекции» сразу после подтверждения.'
    : 'Платёж не был завершён — предмет не выдан.' + (inv ? ' Заказ №' + inv + ' сохранён: его можно оплатить ещё раз из игры.' : '');
  const button = target ? '<a class="btn" href="' + htmlEsc(target) + '">Вернуться в игру</a>' : '<p class="hint">Адрес игры на этом сервере не настроен (PRIME_GAME_URL) — откройте игру вручную.</p>';
  return (
    '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex"><title>PRIME TIME: SHOWDOWN — ' + htmlEsc(title) + '</title><style>' +
    'html,body{margin:0;min-height:100%;background:#0b0820;color:#f1ecff;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}' +
    'body{display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px;box-sizing:border-box;' +
    'background:radial-gradient(80% 50% at 50% 15%,rgba(124,77,255,.35),transparent 70%),linear-gradient(180deg,#24104f,#0b0820)}' +
    '.card{max-width:420px;width:100%;padding:26px 22px;border-radius:22px;text-align:center;background:linear-gradient(180deg,#24104f,#120a2e);' +
    'box-shadow:0 0 0 1px rgba(255,210,58,.55),0 20px 50px rgba(0,0,0,.55)}' +
    '.brand{font-weight:900;letter-spacing:.08em;font-size:13px;color:#b9a6ef}.brand b{color:#ffd23a}' +
    'h1{margin:12px 0 8px;font-size:22px;color:' + (ok ? '#ffd23a' : '#ffc58a') + '}p{margin:0 0 18px;line-height:1.5;font-size:15px;color:#d9cff7}' +
    '.btn{display:inline-block;padding:14px 22px;border-radius:14px;background:linear-gradient(180deg,#fff1b8,#ffd23a 55%,#f29a1e);' +
    'color:#241200;font-weight:800;text-decoration:none;letter-spacing:.03em}.hint{font-size:13px;color:#b9a6ef}' +
    '</style></head><body><main class="card"><div class="brand">PRIME TIME: <b>SHOWDOWN</b> · PRIME SHOP</div>' +
    '<h1>' + htmlEsc(title) + '</h1><p>' + htmlEsc(text) + '</p>' + button + '</main></body></html>'
  );
}

/**
 * GET|POST /api/prime/pay/robokassa/success|fail — the player's way back. Proves nothing (SuccessURL is a page,
 * FailURL is not even signed): a redirect to the game, which asks the order's real status. The address comes
 * from the server's setting (PRIME_GAME_URL), never from the request.
 */
function back(e, kind) {
  let raw = '';
  try {
    raw = String(e.request.formValue('InvId') || '');
  } catch (_) {
    raw = '';
  }
  const inv = INV_RE.test(raw) ? raw : '';
  // staging's invoice: back to staging's own way back (it knows the order and its game)
  const relay = inv ? relayFor(Number(inv)) : '';
  if (relay) return e.redirect(303, relay + '/api/prime/pay/robokassa/' + (kind === 'success' ? 'success' : 'fail') + '?InvId=' + inv);
  if (inv) {
    try {
      const o = findOne(e.app, 'shop_orders', 'invId = {:i}', { i: Number(inv) });
      const k = kind === 'success' ? 'success_return' : 'fail_return';
      if (o && find(e.app, 'shop_payment_events', 'order = {:o} && kind = {:k}', '', 5, { o: o.id, k: k }).length < 5) event(e.app, o, k, '', '');
    } catch (_) {
      /* only a note in the trail */
    }
  }
  const game = gameUrl();
  if (!game) {
    // no redirect possible: never a blank page — the return page with a button (on production: the official game)
    e.app.logger().warn('prime-pay: PRIME_GAME_URL is missing or invalid — the return page is shown instead of a redirect');
    const fallback = role() === 'production' ? returnUrl(OFFICIAL_GAME, kind, inv) : '';
    return e.html(200, returnPage(kind, inv, fallback));
  }
  return e.redirect(303, returnUrl(game, kind, inv));
}

// ------------------------------------------------------------ the player's view
/** GET /api/prime/shop/orders/{inv} — the signed-in account's own order (404 for anybody else's). */
function orderStatus(e) {
  const uid = e.auth.id;
  const raw = String(e.request.pathValue('inv') || '');
  if (!INV_RE.test(raw)) return fail(e, 404, 'order_not_found');
  const inv = Number(raw);
  let o = findOne(e.app, 'shop_orders', 'invId = {:i} && user = {:u}', { i: inv, u: uid });
  if (!o) return fail(e, 404, 'order_not_found');
  // recorded but not delivered (a failed step): deliver it now
  if (o.getString('status') === ST.PAID) {
    try {
      deliver(e.app, o.id);
    } catch (err) {
      e.app.logger().error('prime-pay: delivery retry failed', 'inv', inv, 'error', String(err).slice(0, 300));
    }
  }
  // live: no notification yet → ask Robokassa itself (OpStateExt), at most every RECHECK_MS for one order
  const cfg = config();
  if (cfg.ready && cfg.env === 'live' && o.getString('env') === 'live' && o.getString('status') === ST.PENDING && Date.now() - o.getInt('lastCheckAt') > RECHECK_MS) {
    reconcile(e.app, o.id, cfg);
  }
  o = findOne(e.app, 'shop_orders', 'invId = {:i} && user = {:u}', { i: inv, u: uid });
  return e.json(200, { order: orderOut(o), owned: ownedSkus(e.app, uid) });
}

/** GET /api/prime/shop/purchases — what this PRIME ID owns and its latest orders (every device, every sign-in). */
function purchases(e) {
  const uid = e.auth.id;
  const list = find(e.app, 'shop_orders', 'user = {:u}', '-created', 20, { u: uid });
  return e.json(200, { env: countedEnv(), owned: ownedSkus(e.app, uid), orders: list.map(orderOut) });
}

/** The account's open orders (for /api/prime/shop/status). */
function openOrders(app, uid) {
  return find(app, 'shop_orders', 'user = {:u} && status = "pending_payment" && expiresAt > {:t}', '-created', 10, { u: uid, t: Date.now() }).map(orderOut);
}

// ------------------------------------------------------------ Robokassa's own answer (OpStateExt)
/**
 * Ask Robokassa about one LIVE order (OpStateExt — it never answers for test payments). Only a positive,
 * complete answer (state 100 with the order's amount) counts as a payment; no answer is never one.
 * Returns what happened: paid | failed | pending | not_found | unreachable | …
 */
function reconcile(app, id, cfg) {
  const c = cfg || config();
  if (!c.ready || c.env !== 'live') return 'not_live';
  let o = null;
  app.runInTransaction((tx) => {
    o = tx.findRecordById('shop_orders', id);
    o.set('lastCheckAt', Date.now());
    tx.save(o);
  });
  if (o.getString('env') !== 'live') return 'not_live';
  const inv = o.getInt('invId');
  let res = null;
  try {
    res = $http.send({ url: RK.opStateUrl(c.login, inv, c.p2, c.alg, HASH), method: 'GET', timeout: 8 });
  } catch (err) {
    app.logger().warn('prime-pay: OpStateExt unreachable', 'inv', inv, 'error', String(err).slice(0, 200));
    return 'unreachable';
  }
  if (res.statusCode !== 200) return 'http_' + res.statusCode;
  const st = RK.parseOpState(toString(res.body));
  if (st.result === 3) return 'not_found';
  if (st.result !== 0) {
    app.logger().warn('prime-pay: OpStateExt refused', 'inv', inv, 'result', st.result);
    return 'result_' + st.result;
  }
  const kop = st.outSum ? RK.sumKop(st.outSum) : null;
  // the answer is about an INVOICE NUMBER: it must name this order (Shp_order) and not predate it — an old
  // operation under a number used again never pays a new order
  const bound = RK.opStateBelongs(st, o.id, Date.parse(String(o.getString('created')).replace(' ', 'T')));
  if (st.state === 100 && !bound.ok) {
    app.logger().warn('prime-pay: OpStateExt describes another operation — ignored', 'inv', inv, 'why', bound.why);
    try {
      event(app, o, 'opstate_unbound', bound.why, '');
    } catch (_) {
      /* only a note */
    }
    return 'unbound';
  }
  if (st.state === 100 && kop !== null) {
    let out = 'paid';
    app.runInTransaction((tx) => {
      const r = confirmTx(tx, inv, kop, 'opstate', { sum: st.outSum, opKey: st.opKey || '', shp: '' }, 'live');
      out = r.code || r.status;
    });
    return out;
  }
  app.runInTransaction((tx) => {
    const x = tx.findRecordById('shop_orders', id);
    if (st.opKey && !x.getString('opKey')) x.set('opKey', String(st.opKey).slice(0, 80));
    if ((st.state === 10 || st.state === 60) && x.getString('status') === ST.PENDING) {
      move(tx, x, ST.FAILED, { note: 'robokassa state ' + st.state });
      event(tx, x, 'failed', 'opstate_' + st.state, '');
    } else tx.save(x);
  });
  return st.state === 10 || st.state === 60 ? 'failed' : 'pending';
}

// ------------------------------------------------------------ the five-minute housekeeping
/** Deliver paid orders, close expired ones, ask Robokassa about silent live ones, follow refunds. */
function maintain(app) {
  const cfg = config();
  const now = Date.now();
  let delivered = 0;
  let expired = 0;
  for (const o of find(app, 'shop_orders', 'status = "paid"', 'updated', 50)) {
    try {
      if (deliver(app, o.id) === ST.FULFILLED) delivered++;
    } catch (err) {
      app.logger().error('prime-pay: delivery retry failed', 'inv', o.getInt('invId'), 'error', String(err).slice(0, 300));
    }
  }
  if (cfg.ready && cfg.env === 'live') {
    // live orders without a notification for a while (made 3+ minutes ago, not asked for 10 minutes)
    const silent = find(app, 'shop_orders', 'status = "pending_payment" && env = "live" && expiresAt < {:made} && lastCheckAt < {:asked}', 'lastCheckAt', 20, { made: now + ORDER_TTL_MS - 180000, asked: now - 600000 });
    for (const o of silent) reconcile(app, o.id, cfg);
  }
  for (const o of find(app, 'shop_orders', 'status = "pending_payment" && expiresAt < {:t}', 'expiresAt', 100, { t: now - EXPIRE_GRACE_MS })) {
    try {
      app.runInTransaction((tx) => {
        const x = tx.findRecordById('shop_orders', o.id);
        if (x.getString('status') !== ST.PENDING) return;
        move(tx, x, ST.EXPIRED, { note: 'not paid in time' });
        event(tx, x, 'expired', '', '');
        expired++;
      });
    } catch (err) {
      app.logger().error('prime-pay: could not close an expired order', 'inv', o.getInt('invId'), 'error', String(err).slice(0, 300));
    }
  }
  if (cfg.ready && cfg.refundApi) for (const o of find(app, 'shop_orders', 'status = "refund_pending" && refundRequestId != ""', 'updated', 20)) refundCheck(app, o.getInt('invId'), cfg);
  return { delivered: delivered, expired: expired };
}

// ------------------------------------------------------------ accounts
/**
 * A PRIME ID is being deleted (by the player, the cleanup or the administrator): its open orders close and
 * every order stays for the accounts WITHOUT the link to the person; its rights go with the account (cascade).
 * A payment that still arrives for such an order is kept for review (refund by hand).
 */
function detachAccount(app, uid) {
  for (const o of find(app, 'shop_orders', 'user = {:u}', '', 500, { u: uid })) {
    if (o.getString('status') === ST.PENDING) {
      move(app, o, ST.CANCELED, { note: 'account deleted' });
      event(app, o, 'canceled', 'account_deleted', '');
    }
    o.set('user', '');
    app.save(o);
  }
  // the ledger keeps the order records without the person too
  try {
    LEDGER.forgetUser(app, uid);
  } catch (err) {
    app.logger().error('prime-pay: the invoice ledger could not forget a deleted account', 'error', String(err).slice(0, 200));
  }
}

// ------------------------------------------------------------ after a restored backup
/**
 * Re-apply the ledger to the database (start of the server, `prime-shop recover`): a verified payment the
 * restored pb_data lost is paid and delivered again (the order rebuilt with its id if needed); a refund it lost
 * is a refund again (the right revoked). Orders the database already has in the same state are left alone.
 * Returns { restored, delivered, refunded, problems }.
 */
function recover(app) {
  const out = { restored: 0, delivered: 0, refunded: 0, problems: 0 };
  for (const envName of heldEnvs()) for (const rec of LEDGER.list(app, envName)) {
    if (!rec.paid) continue;
    try {
      app.runInTransaction((tx) => {
        let o = findOne(tx, 'shop_orders', 'invId = {:i}', { i: rec.inv });
        if (o && o.id !== rec.order) {
          // the database holds another order under this number (made before this ledger existed): never merged
          out.problems++;
          app.logger().error('prime-pay: ledger and database disagree on an invoice number — left for review', 'inv', rec.inv);
          return;
        }
        if (!o) {
          o = restoreOrderTx(tx, rec);
          out.restored++;
        }
        const st = o.getString('status');
        if (st === ST.PENDING || st === ST.EXPIRED || st === ST.CANCELED || st === ST.FAILED || st === ST.PAID) {
          const r = confirmTx(tx, rec.inv, rec.kop, 'ledger', { sum: rec.paid.sum, shp: rec.order }, envName);
          if (r.status === ST.FULFILLED) out.delivered++;
        }
        if (rec.refunded) {
          const x = tx.findRecordById('shop_orders', rec.order);
          const now = x.getString('status');
          if (now === ST.FULFILLED || now === ST.PAID || now === ST.REVIEW) {
            move(tx, x, ST.REFUND_PENDING, { refundKop: rec.refunded.kop || x.getInt('amountKop'), note: 'refund restored from the ledger' });
          }
          if (x.getString('status') === ST.REFUND_PENDING) {
            refundDoneTx(tx, x, !!rec.refunded.keepItem, 'ledger');
            out.refunded++;
          }
        }
      });
    } catch (err) {
      out.problems++;
      app.logger().error('prime-pay: re-applying the ledger failed for an invoice', 'inv', rec.inv, 'error', String(err).slice(0, 300));
    }
  }
  if (out.restored || out.delivered || out.refunded || out.problems) {
    console.log('PRIME: invoice ledger re-applied — orders rebuilt ' + out.restored + ', delivered ' + out.delivered + ', refunds ' + out.refunded + ', problems ' + out.problems);
  }
  return out;
}

/** The environments whose orders this server may hold: production — live and demo; staging / dev — test and demo. */
function heldEnvs() {
  return role() === 'production' ? ['live', 'demo'] : ['test', 'demo'];
}

/**
 * The end of a demonstration (`prime-shop demo-end`, e.g. before live sales start): every active demo right is
 * revoked (kept in the history, reason demo_ended), the open demo orders are closed. Real rights are untouched.
 */
function demoEnd(app) {
  let revoked = 0;
  let closed = 0;
  for (const r of find(app, 'shop_entitlements', 'env = "demo" && status = "active"', 'created', 5000)) {
    app.runInTransaction((tx) => {
      const x = tx.findRecordById('shop_entitlements', r.id);
      if (x.getString('status') !== 'active') return;
      x.set('status', 'revoked');
      x.set('revokedAt', Date.now());
      x.set('revokeReason', 'demo_ended');
      tx.save(x);
      revoked++;
    });
  }
  for (const o of find(app, 'shop_orders', 'env = "demo" && status = "pending_payment"', 'created', 5000)) {
    app.runInTransaction((tx) => {
      const x = tx.findRecordById('shop_orders', o.id);
      if (x.getString('status') !== ST.PENDING) return;
      move(tx, x, ST.CANCELED, { note: 'the demonstration ended' });
      event(tx, x, 'canceled', 'demo_ended', '');
      closed++;
    });
  }
  return { revoked: revoked, closed: closed };
}

/** For «Мои данные» (account export): the account's orders and rights. */
function exportOf(app, uid) {
  return {
    orders: find(app, 'shop_orders', 'user = {:u}', 'created', 200, { u: uid }).map((o) => {
      const x = orderOut(o);
      x.paymentMethod = o.getString('paymentMethod');
      return x;
    }),
    rights: find(app, 'shop_entitlements', 'user = {:u}', 'created', 200, { u: uid }).map((r) => ({
      sku: r.getString('sku'),
      environment: r.getString('env'),
      status: r.getString('status'),
      source: r.getString('source'),
      granted: r.getInt('grantedAt') ? new Date(r.getInt('grantedAt')).toISOString() : null,
      revoked: r.getInt('revokedAt') ? new Date(r.getInt('revokedAt')).toISOString() : null,
    })),
  };
}

// ------------------------------------------------------------ refunds (the administrator only)
function byInv(app, inv) {
  return findOne(app, 'shop_orders', 'invId = {:i}', { i: inv });
}

function revokeTx(tx, o, reason) {
  const r = findOne(tx, 'shop_entitlements', 'order = {:o} && status = "active"', { o: o.id });
  if (!r) return false;
  r.set('status', 'revoked');
  r.set('revokedAt', Date.now());
  r.set('revokeReason', String(reason).slice(0, 40));
  tx.save(r);
  event(tx, o, 'revoked', reason, '');
  return true;
}

/** A refund did not happen (refused, cancelled in the cabinet): the order returns to what it was. */
function refundBackTx(tx, o, why) {
  const has = findOne(tx, 'shop_entitlements', 'order = {:o} && status = "active"', { o: o.id });
  move(tx, o, has ? ST.FULFILLED : ST.REVIEW, has ? {} : { reviewReason: 'refund_failed' });
  event(tx, o, 'refund_failed', why, '');
}

/**
 * Start a refund (`prime-shop refund`): the order → refund_pending (nothing is revoked yet: the money is not
 * back yet). With the Refund API switched on (live, Password3, PRIME_PAY_REFUND_API=on) the request goes to
 * Robokassa; otherwise the administrator refunds in Robokassa's cabinet and confirms with refund-done.
 */
function refundStart(app, inv, kop, reason, useApi, cfg) {
  const c = cfg || config();
  const o = byInv(app, inv);
  if (!o) return 'no such order';
  const st = o.getString('status');
  if (st !== ST.FULFILLED && st !== ST.PAID && st !== ST.REVIEW) return 'the order is ' + st + ': nothing to refund';
  const amount = kop || o.getInt('amountKop');
  if (!(amount >= 1 && amount <= o.getInt('amountKop'))) return 'the refund must be between 0.01 and the order amount';
  if (useApi && !c.refundApi) return 'the Refund API is not switched on here (live mode, ROBOKASSA_PASSWORD_3, PRIME_PAY_REFUND_API=on)';
  let opKey = o.getString('opKey');
  if (useApi && !opKey) {
    reconcile(app, o.id, c);
    opKey = byInv(app, inv).getString('opKey');
    if (!opKey) return 'Robokassa has not given the operation key (OpKey) for this order';
  }
  app.runInTransaction((tx) => {
    const x = tx.findRecordById('shop_orders', o.id);
    move(tx, x, ST.REFUND_PENDING, { refundKop: amount, note: String(reason || '').slice(0, 300) });
    event(tx, x, 'refund_requested', useApi ? 'api' : 'manual', 'amount ' + amount + ' kop; ' + String(reason || '').slice(0, 200));
  });
  if (!useApi) return 'ok: refund_pending — refund in the Robokassa cabinet, then: pocketbase prime-shop refund-done ' + inv;
  const payload = { OpKey: opKey };
  if (amount !== o.getInt('amountKop')) payload.RefundSum = Number(RK.outSum(amount));
  let res = null;
  try {
    res = $http.send({ url: RK.REFUND_CREATE_URL, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(RK.refundToken(payload, c.p3, (t, s) => $security.hs256(t, s))), timeout: 15 });
  } catch (err) {
    return 'refund_pending, but Robokassa did not answer — check the cabinet before trying again (' + String(err).slice(0, 120) + ')';
  }
  const j = res.json || {};
  if (res.statusCode === 200 && j.success === true && typeof j.requestId === 'string') {
    app.runInTransaction((tx) => {
      const x = tx.findRecordById('shop_orders', o.id);
      x.set('refundRequestId', j.requestId.slice(0, 64));
      tx.save(x);
      event(tx, x, 'refund_sent', 'api', 'request ' + j.requestId.slice(0, 64));
    });
    return 'ok: Robokassa accepted the refund request (' + j.requestId + ') — the money is not back until refund-check says «finished»';
  }
  app.runInTransaction((tx) => refundBackTx(tx, tx.findRecordById('shop_orders', o.id), 'api_' + res.statusCode));
  return 'Robokassa refused the refund (' + res.statusCode + ' ' + String(j.message || '').slice(0, 120) + ') — the order is back as it was';
}

/** The money is back (confirmed by the administrator or by the Refund API): refunded; the order's right revoked. */
function refundDoneTx(tx, o, keepItem, via) {
  move(tx, o, ST.REFUNDED, { refundedAt: Date.now() });
  event(tx, o, 'refunded', via, '');
  // outside the database too: a restored older pb_data must not give the item back after this refund
  LEDGER.update(tx, o.getString('env'), o.getInt('invId'), { refunded: { at: Date.now(), kop: o.getInt('refundKop'), keepItem: !!keepItem } });
  const full = o.getInt('refundKop') >= o.getInt('amountKop');
  if (!keepItem && full) revokeTx(tx, o, 'refunded');
}

function refundDone(app, inv, keepItem) {
  const o = byInv(app, inv);
  if (!o) return 'no such order';
  if (o.getString('status') !== ST.REFUND_PENDING) return 'the order is ' + o.getString('status') + ' (start with prime-shop refund)';
  app.runInTransaction((tx) => refundDoneTx(tx, tx.findRecordById('shop_orders', o.id), keepItem, 'manual'));
  return 'ok: refunded' + (keepItem || o.getInt('refundKop') < o.getInt('amountKop') ? ' (the item stays with the account)' : ' (the item of this order is revoked; other rights stay)');
}

function refundFailed(app, inv, why) {
  const o = byInv(app, inv);
  if (!o) return 'no such order';
  if (o.getString('status') !== ST.REFUND_PENDING) return 'the order is ' + o.getString('status');
  app.runInTransaction((tx) => refundBackTx(tx, tx.findRecordById('shop_orders', o.id), why || 'manual'));
  return 'ok: the refund is off, the order is back as it was';
}

/** Refund API: the state of the request (finished → refunded; canceled → back; processing → wait). */
function refundCheck(app, inv, cfg) {
  const c = cfg || config();
  const o = byInv(app, inv);
  if (!o || o.getString('status') !== ST.REFUND_PENDING || !o.getString('refundRequestId')) return 'nothing to check';
  let res = null;
  try {
    res = $http.send({ url: RK.REFUND_STATE_URL + '?id=' + encodeURIComponent(o.getString('refundRequestId')), method: 'GET', timeout: 10 });
  } catch (err) {
    return 'Robokassa did not answer';
  }
  const state = RK.refundState(res.json);
  if (state === 'finished') {
    app.runInTransaction((tx) => refundDoneTx(tx, tx.findRecordById('shop_orders', o.id), false, 'api'));
    return 'finished: refunded';
  }
  if (state === 'canceled') {
    app.runInTransaction((tx) => refundBackTx(tx, tx.findRecordById('shop_orders', o.id), 'api_canceled'));
    return 'canceled in the Robokassa cabinet: the order is back as it was';
  }
  return state || 'unknown answer (' + res.statusCode + ')';
}

// ------------------------------------------------------------ the console command
function nick(app, uid) {
  if (!uid) return '(account deleted)';
  const p = findOne(app, 'profiles', 'user = {:u}', { u: uid });
  return uid + (p ? ' ' + p.getString('nickname') : '');
}

function line(app, o) {
  const k = o.getInt('amountKop');
  return [o.getInt('invId'), o.getString('env'), o.getString('status'), o.getString('sku'), (k / 100).toFixed(2) + ' RUB', nick(app, o.getString('user')), o.getString('created').slice(0, 19), o.getString('reviewReason')].join('  ');
}

/**
 * `pocketbase prime-shop …` — the administrator's tool on the server itself (shell access = trusted). There is
 * no public «grant», «mark paid» or «refund» button anywhere: these are the only manual actions.
 */
function cli(app, args) {
  const a = args || [];
  const cmd = a[0] || 'help';
  const inv = INV_RE.test(a[1] || '') ? Number(a[1]) : 0;
  // (words and key=value like `pocketbase invites …` — a «--flag» would be taken by the console itself)
  const flag = (f) => a.indexOf(f) >= 0;
  const opt = (k) => {
    for (const x of a) if (typeof x === 'string' && x.indexOf(k + '=') === 0) return x.slice(k.length + 1);
    return '';
  };
  const out = (s) => console.log(s);
  const need = () => {
    if (!inv) out('give the order number (InvId)');
    return !!inv;
  };
  switch (cmd) {
    case 'status': {
      const c = publicConfig();
      for (const k of Object.keys(c)) out(k + ': ' + c[k]);
      for (const s of Object.keys(NEXT)) out('orders ' + s + ': ' + find(app, 'shop_orders', 'status = {:s}', '', 10000, { s: s }).length);
      return;
    }
    case 'selftest': {
      // reference signatures with made-up passwords (no secret involved): compare with `npm run payments`
      const H = HASH;
      out('md5    ' + RK.hash('md5', RK.resultBase('100.000000', '450009', 'test-password-2', [['Shp_login', 'Vasya'], ['Shp_oplata', '1']]), H));
      out('sha256 ' + RK.hash('sha256', RK.paymentBase('demo', '149.00', 900000001, '', 'test-password-1', [['Shp_order', 'abc123def456ghi']]), H));
      out('sha512 ' + RK.hash('sha512', RK.opStateBase('demo', '1000001', 'test-password-2'), H));
      out('hs256  ' + RK.refundToken({ OpKey: 'demo-op-key', RefundSum: 10 }, 'test-password-3', (t, s) => $security.hs256(t, s)));
      return;
    }
    case 'orders': {
      const n = Math.min(200, Math.max(1, Number(a[1]) || 30));
      for (const o of find(app, 'shop_orders', 'id != ""', '-created', n)) out(line(app, o));
      return;
    }
    case 'order': {
      if (!need()) return;
      const o = byInv(app, inv);
      if (!o) return out('no such order');
      out(line(app, o));
      for (const k of ['offerRevision', 'paidSum', 'paidVia', 'paymentMethod', 'fee', 'refundKop', 'refundRequestId', 'note']) if (o.get(k)) out('  ' + k + ': ' + o.get(k));
      for (const ev of find(app, 'shop_payment_events', 'invId = {:i}', 'created', 100, { i: inv })) out('  ' + ev.getString('created').slice(0, 19) + '  ' + ev.getString('kind') + '  ' + ev.getString('code') + '  ' + ev.getString('detail'));
      for (const r of find(app, 'shop_entitlements', 'order = {:o}', '', 5, { o: o.id })) out('  right: ' + r.getString('sku') + ' ' + r.getString('status') + ' ' + r.getString('revokeReason'));
      return;
    }
    case 'deliver': {
      if (!need()) return;
      const o = byInv(app, inv);
      if (!o) return out('no such order');
      return out(o.getString('status') === ST.PAID ? 'now: ' + deliver(app, o.id) : 'the order is ' + o.getString('status') + ' (only a paid order is delivered)');
    }
    case 'review': {
      if (!need()) return;
      const o = byInv(app, inv);
      if (!o) return out('no such order');
      if (a[2] === 'deliver') {
        if (o.getString('status') !== ST.REVIEW) return out('the order is ' + o.getString('status'));
        let st = '';
        app.runInTransaction((tx) => {
          const x = tx.findRecordById('shop_orders', o.id);
          if (activeRight(tx, x.getString('user'), x.getString('sku'), x.getString('env')) || !x.getString('user')) {
            st = 'cannot deliver: the account is gone or already owns it — refund instead';
            return;
          }
          // requires_review → fulfilled: the right of this paid order, created by the administrator's decision
          const r = new Record(tx.findCollectionByNameOrId('shop_entitlements'));
          const it = R.catalog[x.getString('sku')] || { item: '', kind: '' };
          r.set('user', x.getString('user'));
          r.set('sku', x.getString('sku'));
          r.set('item', it.item);
          r.set('kind', it.kind);
          r.set('order', x.id);
          r.set('source', 'support');
          r.set('env', x.getString('env'));
          r.set('status', 'active');
          r.set('grantedAt', Date.now());
          tx.save(r);
          move(tx, x, ST.FULFILLED, { fulfilledAt: Date.now() });
          event(tx, x, 'fulfilled', 'admin', opt('note'));
          st = 'ok: delivered';
        });
        return out(st);
      }
      if (a[2] === 'note') {
        const text = a.slice(3).join(' ').slice(0, 300);
        app.runInTransaction((tx) => {
          const x = tx.findRecordById('shop_orders', o.id);
          x.set('note', text);
          tx.save(x);
          event(tx, x, 'admin', 'note', text);
        });
        return out('ok');
      }
      return out('prime-shop review <InvId> deliver [note=…] | note <text>');
    }
    case 'cancel': {
      if (!need()) return;
      const o = byInv(app, inv);
      if (!o || o.getString('status') !== ST.PENDING) return out('only an unpaid open order can be cancelled');
      app.runInTransaction((tx) => {
        const x = tx.findRecordById('shop_orders', o.id);
        move(tx, x, ST.CANCELED, { note: 'cancelled by the administrator' });
        event(tx, x, 'canceled', 'admin', '');
      });
      return out('ok: cancelled (a payment that still arrives is kept and delivered or reviewed)');
    }
    case 'recover': {
      // after restore.sh: payments and refunds the restored database lost come back from the ledger
      const r = recover(app);
      return out('rebuilt ' + r.restored + ', delivered ' + r.delivered + ', refunds re-applied ' + r.refunded + ', problems ' + r.problems);
    }
    case 'ledger': {
      // the invoice ledger beside the database: its mark against the database's last number (counted env first)
      const counted = countedEnv();
      for (const envName of [counted].concat(heldEnvs().filter((x) => x !== counted))) {
        const h = LEDGER.health(app, envName);
        const last = find(app, 'shop_orders', 'env = {:e}', '-invId', 1, { e: envName })[0];
        const recs = LEDGER.list(app, envName);
        if (envName !== counted && !recs.length && !last) continue;
        out('[' + envName + (envName === counted ? ', counted' : '') + '] ledger: ' + (h.ok ? h.dir : 'UNAVAILABLE — ' + h.problem));
        out('mark: ' + (h.ok ? LEDGER.mark(app, envName) : '-') + ', database last: ' + (last ? last.getInt('invId') : 0) + ', next: ' + (h.ok ? pickInv(envName, last ? last.getInt('invId') : 0, LEDGER.mark(app, envName), Date.now()) : '-'));
        const missing = recs.filter((r) => r.paid && !find(app, 'shop_orders', 'invId = {:i}', '', 1, { i: r.inv }).length);
        out('orders in the ledger: ' + recs.length + ', paid: ' + recs.filter((r) => r.paid).length + ', refunded: ' + recs.filter((r) => r.refunded).length + ', paid but missing in the database: ' + missing.length + (missing.length ? ' (run: recover)' : ''));
      }
      return;
    }
    case 'demo-end': {
      const r = demoEnd(app);
      return out('demo rights revoked: ' + r.revoked + ', open demo orders closed: ' + r.closed + ' (real rights untouched)');
    }
    case 'reconcile': {
      if (inv) {
        const o = byInv(app, inv);
        return out(o ? reconcile(app, o.id) : 'no such order');
      }
      const r = maintain(app);
      return out('delivered ' + r.delivered + ', expired ' + r.expired);
    }
    case 'refund': {
      if (!need()) return;
      const sum = /^[0-9]{1,7}(\.[0-9]{1,2})?$/.test(a[2] || '') ? a[2] : '';
      const kop = sum ? rubToKop(Number(sum)) : 0;
      if (sum && !kop) return out('the amount is in roubles, e.g. 149 or 74.50');
      const reason = opt('reason');
      if (!reason) return out('give a reason: reason="…"');
      return out(refundStart(app, inv, kop, reason, flag('api')));
    }
    case 'refund-done':
      if (!need()) return;
      return out(refundDone(app, inv, flag('keep-item')));
    case 'refund-failed':
      if (!need()) return;
      return out(refundFailed(app, inv, opt('reason') || 'manual'));
    case 'refund-check':
      if (!need()) return;
      return out(refundCheck(app, inv));
    default:
      out(
        [
          'pocketbase prime-shop status                       configuration (no secret values) and order counts',
          'pocketbase prime-shop selftest                     reference signatures (made-up passwords)',
          'pocketbase prime-shop orders [N]                   the latest orders',
          'pocketbase prime-shop order <InvId>                one order with its trail and right',
          'pocketbase prime-shop reconcile [InvId]            ask Robokassa (OpStateExt, live only) / run the housekeeping',
          'pocketbase prime-shop ledger                       the invoice ledger beside the database (mark, paid, missing)',
          'pocketbase prime-shop recover                      after a restore: re-apply paid orders and refunds from the ledger',
          'pocketbase prime-shop demo-end                     end a demonstration: revoke every demo right (real ones untouched)',
          'pocketbase prime-shop deliver <InvId>              deliver a paid order now',
          'pocketbase prime-shop cancel <InvId>               close an unpaid open order',
          'pocketbase prime-shop review <InvId> deliver [note=…] | note <text>   decide an order that needs review',
          'pocketbase prime-shop refund <InvId> [RUB] reason="…" [api]   start a refund (nothing is revoked yet)',
          'pocketbase prime-shop refund-done <InvId> [keep-item]         the money is back: refunded, the right revoked',
          'pocketbase prime-shop refund-failed <InvId> [reason="…"]      the refund did not happen',
          'pocketbase prime-shop refund-check <InvId>         Refund API: finished / processing / canceled',
        ].join('\n'),
      );
  }
}

module.exports = {
  ST,
  NEXT,
  ORDER_TTL_MS,
  INV_SCHEME,
  DEMO_MAX_DAYS,
  envOfInv,
  demoWindow,
  invFloor,
  pickInv,
  normalizeGameUrl,
  receiptName,
  role,
  countedEnv,
  config,
  publicConfig,
  shopEnv,
  rubToKop,
  priceKop,
  pricesFor,
  listPrices,
  salesOpen,
  activeRight,
  ownedSkus,
  paidFighters,
  fighterUnlocked,
  startOrder,
  result,
  back,
  orderStatus,
  purchases,
  openOrders,
  reconcile,
  maintain,
  detachAccount,
  recover,
  demoEnd,
  heldEnvs,
  exportOf,
  cli,
};
