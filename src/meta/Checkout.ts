import type { OfferRevision } from '../config/offer.config';
import { SHOP_ITEMS, formatKop, rubToKop, type ShopItemDef, type ShopSku } from '../config/shop.config';
import type { ShopItemState } from './Shop';

// Alpha 1.8.8 (stage 3) — PRIME CHECKOUT: what the purchase window shows and why a purchase cannot
// go on, as a pure function of what the game knows (the catalog, the item's state, the account, the
// offer, what the server said). No network, no save, no ownership here:
//
//   opening the window       buildCheckout(…) — a preview, never a financial record
//   the server's own check   PrimeApi.shopStatus / startCheckout (backend lib/checkout.js) — the
//                            server decides price, availability, consent; never the browser
//   consent to the offer     recorded by the server only (consents), never in the save or localStorage
//   order, payment, delivery 1.8.8 stage 4 — the server (lib/payments.js) and Robokassa; the game only
//                            follows the order (src/meta/Payments.ts, ui/checkoutOrder.ts)
//
// While prices are not approved, sales are closed, no offer is published or payments are not
// connected, every path ends in an honest «cannot continue yet»: the window can be looked at, nothing
// can be bought.

/**
 * This build can hand a purchase to Robokassa's payment page (1.8.8 stage 4). The SERVER still decides
 * whether anything can be paid (/api/prime/shop/status «payments»: Robokassa configured for its role, sales
 * open, an approved price, a published offer) — today none of that is true for the real shop, so
 * «Перейти к оплате» stays inactive there.
 */
export const CLIENT_PAYMENTS = true;

/** What this page knows about the PRIME ID that would buy. */
export type CheckoutAccountState =
  /** This copy of the game has no PRIME NETWORK (a build without accounts). */
  | 'none'
  | 'connecting'
  /** The server does not answer. */
  | 'offline'
  | 'guest'
  /** Was signed in, the session ended: sign in again. */
  | 'expired'
  | 'unverified'
  /** The PRIME ID documents (1.8.4) must be accepted first. */
  | 'terms'
  /** The PRIME ID plays on another device now (this page gave up its game session). */
  | 'elsewhere'
  | 'ready';

export interface CheckoutAccount {
  state: CheckoutAccountState;
  /** The account's record id (never shown) — only to notice a switch to another account. */
  id: string | null;
  nickname: string;
  /** Already masked for display (maskEmail). */
  email: string;
}

/** Why the purchase cannot go on — the first reason, in the order the window explains them. */
export type CheckoutBlock =
  | 'unavailable'
  | 'owned'
  | 'seasonal_only'
  | 'price_pending'
  | 'sales_closed'
  | 'offer_missing'
  | 'no_network'
  | 'connecting'
  | 'offline'
  | 'guest'
  | 'session_expired'
  | 'unverified'
  | 'legal_required'
  | 'adult_only'
  | 'server_unavailable'
  | 'rate_limited'
  | 'session_elsewhere'
  | 'account_changed'
  | 'payments_unavailable';

/** The offer and this account: none published / never accepted / an older revision accepted / the current one accepted. */
export type ConsentState = 'none' | 'needed' | 'renew' | 'accepted';

export interface CheckoutInput {
  sku: string;
  /** Shop.state(item); null for an unknown sku. */
  state: ShopItemState | null;
  /** The price to show: the server's quote when there is one, else the catalog's (null: not approved). */
  priceRub: number | null;
  salesOpen: boolean;
  offer: OfferRevision | null;
  account: CheckoutAccount;
  /** The account the purchase was started under (a resumed flow); undefined: started right here. */
  startedFor?: string | null;
  /** The newest offer revision this account accepted — as the SERVER says (0: none / not known). */
  acceptedRevision: number;
  /** A real payment can be started (stage 4: Robokassa connected and checked). False in 1.8.8 stage 3. */
  paymentsReady: boolean;
  /** The consent box is ticked right now (never ticked by itself). */
  consentTicked: boolean;
}

export interface CheckoutView {
  sku: string;
  item: ShopItemDef | null;
  priceRub: number | null;
  priceText: string;
  currency: 'RUB';
  account: CheckoutAccount;
  offer: OfferRevision | null;
  consent: ConsentState;
  /** The first reason the purchase cannot go on (null: nothing blocks). */
  block: CheckoutBlock | null;
  /** «Перейти к оплате» may be pressed: nothing blocks, the offer is accepted or ticked, payments are ready. */
  canPay: boolean;
}

const ACCOUNT_BLOCK: Record<CheckoutAccountState, CheckoutBlock | null> = {
  none: 'no_network',
  connecting: 'connecting',
  offline: 'offline',
  guest: 'guest',
  expired: 'session_expired',
  unverified: 'unverified',
  terms: 'legal_required',
  elsewhere: 'session_elsewhere',
  ready: null,
};

export function consentOf(offer: OfferRevision | null, acceptedRevision: number): ConsentState {
  if (!offer) return 'none';
  if (acceptedRevision === offer.revision) return 'accepted';
  return acceptedRevision > 0 ? 'renew' : 'needed';
}

/** Everything the PRIME CHECKOUT window shows, and the first reason it cannot go on. */
export function buildCheckout(i: CheckoutInput): CheckoutView {
  const item = SHOP_ITEMS.find((x) => x.sku === i.sku) ?? null;
  const consent = consentOf(i.offer, i.acceptedRevision);
  let block: CheckoutBlock | null = null;
  const st = i.state;
  // what holds for everybody first (the item itself), then the account, then the payment
  if (!item || !st) block = 'unavailable';
  else if (st.owned || st.status === 'received') block = 'owned';
  else if (st.status === 'seasonal' || st.status === 'upcoming') block = 'seasonal_only';
  else if (i.priceRub === null) block = 'price_pending';
  else if (!i.salesOpen) block = 'sales_closed';
  else if (!i.offer) block = 'offer_missing';
  else if (ACCOUNT_BLOCK[i.account.state]) block = ACCOUNT_BLOCK[i.account.state];
  else if (i.startedFor && i.account.id && i.startedFor !== i.account.id) block = 'account_changed';
  else if (!i.paymentsReady) block = 'payments_unavailable';
  const consentOk = consent === 'accepted' || ((consent === 'needed' || consent === 'renew') && i.consentTicked);
  return {
    sku: i.sku,
    item,
    priceRub: i.priceRub,
    priceText: i.priceRub === null ? 'Цена уточняется' : formatKop(rubToKop(i.priceRub) ?? 0),
    currency: 'RUB',
    account: i.account,
    offer: i.offer,
    consent,
    block,
    canPay: block === null && consentOk && i.paymentsReady,
  };
}

/** «pl•••@gmail.com» — enough to recognise one's own address, not more. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at < 1) return '';
  const name = email.slice(0, at);
  return `${name.slice(0, Math.min(2, name.length))}•••${email.slice(at)}`;
}

// ------------------------------------------------------------------ «back to the item» after PRIME ID
/**
 * The short-lived note that brings a player back to the item after signing in to PRIME ID (the sign-in
 * may reload the page). Kept in sessionStorage (this tab only): the item, where they came from, the
 * step, when, and which account was signed in then (to notice a switch). Never a password, a token,
 * a price, payment details or ownership.
 */
export interface PendingCheckout {
  v: 1;
  sku: ShopSku;
  from: 'menu' | 'collection';
  step: 'item' | 'checkout';
  at: number;
  account: string | null;
}

export const CHECKOUT_PENDING_KEY = 'primetime-showdown-checkout-v1';
/** After this the note is stale: the player simply finds the shop as usual. */
export const CHECKOUT_PENDING_TTL_MS = 30 * 60 * 1000;

interface MiniStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export function sessionStore(): MiniStorage | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

export function savePending(store: MiniStorage | null, p: Omit<PendingCheckout, 'v'>): void {
  try {
    store?.setItem(CHECKOUT_PENDING_KEY, JSON.stringify({ v: 1, sku: p.sku, from: p.from, step: p.step, at: p.at, account: p.account }));
  } catch {
    /* storage full or blocked: the player finds the item again by hand */
  }
}

export function clearPending(store: MiniStorage | null): void {
  try {
    store?.removeItem(CHECKOUT_PENDING_KEY);
  } catch {
    /* nothing to clear */
  }
}

/** The note, if it is well-formed, fresh and names a real item; anything else is dropped. */
export function loadPending(store: MiniStorage | null, now: number = Date.now()): PendingCheckout | null {
  let raw: string | null = null;
  try {
    raw = store?.getItem(CHECKOUT_PENDING_KEY) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  let p: Record<string, unknown> | null = null;
  try {
    const v: unknown = JSON.parse(raw);
    p = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    p = null;
  }
  const ok =
    !!p &&
    p.v === 1 &&
    typeof p.sku === 'string' &&
    SHOP_ITEMS.some((i) => i.sku === p!.sku) &&
    (p.from === 'menu' || p.from === 'collection') &&
    (p.step === 'item' || p.step === 'checkout') &&
    typeof p.at === 'number' &&
    now - p.at >= 0 &&
    now - p.at <= CHECKOUT_PENDING_TTL_MS &&
    (p.account === null || (typeof p.account === 'string' && p.account.length <= 64));
  if (!ok) {
    clearPending(store);
    return null;
  }
  return p as unknown as PendingCheckout;
}

/**
 * What a pending note means now: «resume» (signed in — back to the item; the window checks
 * everything again), «reset» (another account than the one it was started under), «wait» (still not
 * signed in: nothing happens, the note runs out by itself).
 */
export function resumeDecision(p: PendingCheckout, acc: CheckoutAccount): 'resume' | 'reset' | 'wait' {
  if (acc.state === 'guest' || acc.state === 'expired' || acc.state === 'none' || acc.state === 'offline' || acc.state === 'connecting') return 'wait';
  if (p.account && acc.id && p.account !== acc.id) return 'reset';
  return 'resume';
}
