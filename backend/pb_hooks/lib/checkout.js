// PRIME TIME: SHOWDOWN — Alpha 1.8.8 stage 3 «PRIME CHECKOUT»: the server side of buying in PRIME SHOP.
// Loaded with require() inside every handler (PocketBase runs each handler in its own JS context).
//
//   GET  /api/prime/shop/offer          the offer revision in force (public; null until one is published)
//   GET  /api/prime/shop/status         (signed in) email confirmed?, PRIME ID documents still to accept,
//                                       the offer in force and the newest revision THIS account accepted,
//                                       whether sales and payments are open; 1.8.8 stage 4: the payment
//                                       environment (live | test), the server's prices in kopecks, the
//                                       items this account owns (shop_entitlements) and its open orders
//   POST /api/prime/shop/offer/accept   (signed in, email confirmed) {revision, sha256, lang}: accept THE
//                                       CURRENT revision. One consents row, written only here: the owner is
//                                       e.auth (never a field of the request), the time is the server's,
//                                       the row names the revision and the hash of its text. Nothing to
//                                       accept while no revision is published (409 offer_unavailable).
//   POST /api/prime/shop/checkout       (signed in) {sku}: the server's own checks, in a fixed order. The
//                                       price comes from shop_rules.js — never from the request (any price,
//                                       account or status a request carries is ignored). 1.8.8 stage 4: when
//                                       every check passes and payments are configured (lib/payments.js),
//                                       the order and the Robokassa payment page are made exactly here;
//                                       otherwise the last answer stays 503 «payments_unavailable».
//
// shop_rules.js is generated from the game's config (`npm run backend:rules`): the catalog, the approved
// prices (null = not approved), the offer revisions, LUCIEN's season — and a STAGING-only test block used
// by a server in Robokassa's test mode instead (test prices, stand-in test terms). Live sales need BOTH the
// release flag there and PRIME_SHOP_SALES=open on this server.

const R = require('./shop_rules.js');
const LEGAL = require('./legal.js');
const PAY = require('./payments.js');

const SKU_RE = /^[a-z0-9_]{3,40}$/;
const HASH_RE = /^[a-f0-9]{64}$/;

function body(e) {
  const b = e.requestInfo().body;
  return b && typeof b === 'object' ? b : {};
}

function fail(e, status, code, extra) {
  const out = { code: code };
  if (extra) for (const k of Object.keys(extra)) out[k] = extra[k];
  return e.json(status, out);
}

function dateOf(s) {
  const t = Date.parse(String(s).length <= 10 ? s + 'T00:00:00Z' : s);
  return isFinite(t) ? t : NaN;
}

/** The revision in force at `t` (the same rule as src/config/offer.config.ts). */
function offerAt(t) {
  let cur = null;
  const list = R.offers || [];
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    const at = dateOf(o.effectiveFrom);
    if (isFinite(at) && at <= t && HASH_RE.test(o.sha256) && (!cur || o.revision > cur.revision)) cur = o;
  }
  return cur;
}

/**
 * 1.8.8 stage 4: the terms this server sells under — the published offer; on a server in Robokassa's TEST
 * mode (staging) the stand-in test terms of shop_rules.js instead (no document: url '').
 */
function currentOffer(t) {
  const env = PAY.shopEnv();
  // staging tests and the demonstration accept their own stand-in terms (no money moves), never the offer
  if (env === 'test' || env === 'demo') {
    const o = R[env] && R[env].offer;
    return o && HASH_RE.test(o.sha256) ? o : null;
  }
  return offerAt(t);
}

function offerOut(o) {
  return o ? { revision: o.revision, title: o.title, url: o.url, effectiveFrom: o.effectiveFrom, sha256: o.sha256 } : null;
}

/** Live sales: the release opened them AND this server's administrator did too (test mode: lib/payments.js). */
function salesOpen() {
  return PAY.salesOpen();
}

/** 1.8.8 stage 4: Robokassa configured on this server, in a mode allowed for its role (lib/payments.js). */
function paymentsReady() {
  return PAY.config().ready;
}

function consentRow(app, uid, revision) {
  try {
    return app.findFirstRecordByFilter('consents', 'user = {:u} && doc = "shop_offer" && version = {:v}', { u: uid, v: revision });
  } catch (_) {
    return null;
  }
}

/** The newest offer revision this account accepted (0: none). */
function acceptedRevision(app, uid) {
  try {
    const list = app.findRecordsByFilter('consents', 'user = {:u} && doc = "shop_offer"', '-version', 1, 0, { u: uid });
    return list && list.length ? list[0].getInt('version') : 0;
  } catch (_) {
    return 0;
  }
}

// ---------------------------------------------------------------------- routes
function offer(e) {
  return e.json(200, { offer: offerOut(currentOffer(Date.now())) });
}

function status(e) {
  const u = e.auth;
  const cfg = PAY.config();
  const env = PAY.shopEnv(cfg);
  return e.json(200, {
    verified: u.verified(),
    legal: { needs: LEGAL.needs(e.app, u.id) },
    offer: offerOut(currentOffer(Date.now())),
    accepted: acceptedRevision(e.app, u.id),
    sales: salesOpen(),
    payments: PAY.payReady(cfg),
    // 1.8.8 stage 4: «test» on a server in Robokassa's test mode, «demo» during the official site's demonstration
    // (the game labels every price and step as a test payment); the amounts charged in that mode in kopecks
    // (null = not for sale) and the items' official prices (what the catalog shows)
    env: env,
    prices: PAY.pricesFor(env),
    listPrices: PAY.listPrices(),
    // the items this account really owns here (shop_entitlements) and its open orders (to pay or check)
    owned: PAY.ownedSkus(e.app, u.id),
    orders: PAY.openOrders(e.app, u.id),
  });
}

function acceptOffer(e) {
  const u = e.auth;
  if (!u.verified()) return fail(e, 403, 'not_verified');
  const b = body(e);
  const o = currentOffer(Date.now());
  if (!o) return fail(e, 409, 'offer_unavailable');
  // exactly the revision in force, exactly its text — an older page or a changed text is refused
  if (b.revision !== o.revision || b.sha256 !== o.sha256) return fail(e, 409, 'offer_changed', { offer: offerOut(o) });
  if (consentRow(e.app, u.id, o.revision)) return e.json(200, { accepted: o.revision, duplicate: true });
  try {
    const r = new Record(e.app.findCollectionByNameOrId('consents'));
    r.set('user', u.id);
    r.set('doc', 'shop_offer');
    r.set('version', o.revision);
    r.set('docHash', o.sha256);
    r.set('lang', b.lang === 'en' ? 'en' : 'ru');
    r.set('action', 'checkout');
    e.app.save(r);
  } catch (err) {
    // the unique index (user, revision) of the offer: a parallel request of the same player got there first
    if (consentRow(e.app, u.id, o.revision)) return e.json(200, { accepted: o.revision, duplicate: true });
    throw err;
  }
  return e.json(200, { accepted: o.revision, duplicate: false });
}

/**
 * 1.8.9.5: may this PRIME ID aged 14–17 buy this item at all? null = yes, otherwise the refusal:
 *   adult_only   no age «14-17» on record, the server switch PRIME_SHOP_MINORS is not «on», or the terms in force
 *                do not cover buyers under 18 (no `minors: true`: the offer's registry entry on production; the
 *                TEST-ONLY terms of a staging server carry it, the demonstration's terms do not)
 *   minor_item   a fighter, or a price above the release's limit for one item (shop_rules minors.itemMaxRub)
 * The 30-day total is checked by minorSpend, inside the order's transaction.
 */
function minorRefusal(app, uid, it, kop, t) {
  const o = currentOffer(t);
  if (!LEGAL.minor(app, uid) || String($os.getenv('PRIME_SHOP_MINORS') || '').trim() !== 'on' || !o || o.minors !== true) return 'adult_only';
  const itemMax = Math.round(Number((R.minors || {}).itemMaxRub || 0) * 100);
  if (it.kind === 'fighter' || kop === null || !(itemMax > 0) || kop > itemMax) return 'minor_item';
  return null;
}

/**
 * 1.8.9.5: the 30-day total of a buyer aged 14–17 (shop_rules minors.per30DaysRub), counted INSIDE the order's
 * transaction (PocketBase runs write transactions one after the other: two parallel requests never both pass).
 * Counted: orders of this server's environment made in the last 30 days that are paid, delivered, under review or
 * being refunded, and orders waiting for payment while they can still be paid (their reserve ends with the order's
 * time); never failed, expired, cancelled or refunded ones, and never the open order of this very item (a retry
 * reuses it). Exactly the limit is allowed; one kopeck more → «minor_limit».
 */
function minorSpend(tx, uid, sku, kop, t, envName) {
  const capKop = Math.round(Number((R.minors || {}).per30DaysRub || 0) * 100);
  const since = new Date(t - 30 * 86400000).toISOString().replace('T', ' ');
  let spent = 0;
  for (const x of tx.findRecordsByFilter('shop_orders', 'user = {:u} && env = {:e} && created >= {:s}', '', 1000, 0, { u: uid, e: envName, s: since })) {
    const st = x.getString('status');
    if (st === 'pending_payment') {
      if (x.getString('sku') === sku || x.getInt('expiresAt') <= t) continue;
    } else if (['paid', 'fulfilled', 'requires_review', 'refund_pending'].indexOf(st) < 0) continue;
    spent += x.getInt('amountKop');
  }
  return capKop > 0 && spent + kop <= capKop ? null : 'minor_limit';
}

function checkout(e) {
  const u = e.auth;
  const b = body(e);
  const sku = typeof b.sku === 'string' ? b.sku : '';
  const it = SKU_RE.test(sku) && Object.prototype.hasOwnProperty.call(R.catalog, sku) ? R.catalog[sku] : null;
  if (!it) return fail(e, 404, 'unknown_item');
  if (!u.verified()) return fail(e, 403, 'not_verified');
  if (LEGAL.needs(e.app, u.id).length) return fail(e, 403, 'legal_required');
  const t = Date.now();
  if (it.kind === 'fighter') {
    // one fighter, one id: opened already (for tokens or otherwise) → never sold again
    if (PAY.fighterUnlocked(e.app, u.id, it.item)) return fail(e, 409, 'owned');
    // before and during its season a seasonal star is opened only for the event's tokens
    const season = R.seasons && R.seasons[sku];
    if (season && t < dateOf(season.end)) return fail(e, 409, 'seasonal_only', { event: season.event });
  }
  // 1.8.8 stage 4: already in this account's rights (shop_entitlements) → never sold again
  if (PAY.activeRight(e.app, u.id, sku, PAY.countedEnv())) return fail(e, 409, 'owned');
  const cfg = PAY.config();
  const env = PAY.shopEnv(cfg);
  const kop = PAY.priceKop(sku, env);
  // a demonstration never opens a fighter (a playable character is not a cosmetic to try out)
  if (env === 'demo' && it.kind === 'fighter') return fail(e, 409, 'not_in_demo');
  // 1.8.9: real purchases — adults only (the offer, section 5.1); 1.8.9.5: buyers aged 14–17 only when the server
  // allows it AND the terms in force do (minorRefusal); the same check for a new order, its payment page and a retry —
  // in every mode, so a staging server (test mode, its TEST-ONLY terms) shows exactly what production would do
  const minor = !LEGAL.adult(e.app, u.id);
  if (minor) {
    const why = minorRefusal(e.app, u.id, it, PAY.priceKop(sku, env), t);
    if (why) return fail(e, 403, why);
  }
  if (kop === null) return fail(e, 409, 'price_pending');
  const listKop = PAY.listPrices()[sku];
  const quote = { sku: sku, priceRub: kop / 100, priceKop: kop, listKop: listKop, currency: 'RUB', env: env };
  if (!salesOpen()) return fail(e, 409, 'sales_closed', { quote: quote });
  const o = currentOffer(t);
  if (!o) return fail(e, 409, 'offer_missing', { quote: quote });
  quote.offerRevision = o.revision;
  if (!consentRow(e.app, u.id, o.revision)) return fail(e, 409, 'offer_consent_required', { quote: quote, offer: offerOut(o) });
  if (!cfg.ready) return fail(e, 503, 'payments_unavailable', { quote: quote });
  // here, and only here: the order (owner = e.auth, amount = the server's price) and the payment page; 1.8.9.5: the
  // 30-day limit of a buyer aged 14–17 is counted inside the order's own transaction (minorSpend)
  return PAY.startOrder(e, u.id, sku, it, kop, o, cfg, minor ? (tx) => minorSpend(tx, u.id, sku, kop, Date.now(), env) : null);
}

module.exports = { offer, status, acceptOffer, checkout, offerAt, currentOffer, salesOpen, paymentsReady };
