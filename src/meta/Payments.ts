import { SHOP_ITEMS, type ShopSku } from '../config/shop.config';

// Alpha 1.8.8 (stage 4) — PRIME PAYMENTS: what the game knows about an order and the way back from
// Robokassa, as pure functions. The SERVER decides everything (backend lib/payments.js): an item is the
// player's only when the server's order says «fulfilled» AND the server's list of rights has it. Nothing
// here grants, pays, signs or saves:
//
//   «Перейти к оплате»   the server makes (or gives back) the order and the signed form of Robokassa's own
//                        page; the game checks that the form goes to Robokassa and sends the player there
//   the way back         Robokassa → the server's SuccessURL / FailURL → the game with ?prime_pay=…&inv=…;
//                        that address proves nothing: the game asks the server about the order
//   checking             a few requests over ~45 seconds at most, then «проверим позже» — never endless
//   the rights           entitlements.ts, filled from the server for the signed-in PRIME ID only

/**
 * The payment environment of an order: live (real money), test (a staging server, Robokassa's test mode) or demo
 * (1.8.8 final: the official site's demonstration — Robokassa's test mode, no money moves).
 */
export type PayEnv = 'live' | 'test' | 'demo';

/** Robokassa's test mode (no money moves): every step says so. */
export function isTestPay(env: PayEnv | null | undefined): boolean {
  return env === 'test' || env === 'demo';
}

/** The line every screen of a test-mode purchase carries (the owner's wording). */
export const TEST_PAY_BAND = 'ТЕСТОВАЯ ПОКУПКА — НАСТОЯЩИЕ ДЕНЬГИ НЕ СПИСЫВАЮТСЯ';

export type OrderStatus = 'pending_payment' | 'paid' | 'fulfilled' | 'failed' | 'expired' | 'canceled' | 'refund_pending' | 'refunded' | 'requires_review';

/** An order as the server shows it to its owner (GET /api/prime/shop/orders/{inv}). */
export interface ServerOrder {
  inv: number;
  sku: string;
  title: string;
  amountKop: number;
  currency: 'RUB';
  status: OrderStatus;
  env: PayEnv;
  created: string;
  expiresAt: number;
  paidAt: number;
  fulfilledAt: number;
}

/** Robokassa's payment page as the server signed it: where to go and the form's fields. */
export interface PaymentPage {
  url: string;
  method: 'POST';
  fields: Record<string, string>;
}

const STATUSES: OrderStatus[] = ['pending_payment', 'paid', 'fulfilled', 'failed', 'expired', 'canceled', 'refund_pending', 'refunded', 'requires_review'];

/** A server order, if the answer is one (anything malformed → null: the game shows «нет связи», never a guess). */
export function orderOf(v: unknown): ServerOrder | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.floor(x) : 0);
  if (typeof o.inv !== 'number' || o.inv < 1 || typeof o.sku !== 'string' || !STATUSES.includes(o.status as OrderStatus) || (o.env !== 'test' && o.env !== 'live' && o.env !== 'demo')) return null;
  return {
    inv: n(o.inv),
    sku: o.sku,
    title: typeof o.title === 'string' ? o.title.slice(0, 100) : '',
    amountKop: n(o.amountKop),
    currency: 'RUB',
    status: o.status as OrderStatus,
    env: o.env as PayEnv,
    created: typeof o.created === 'string' ? o.created : '',
    expiresAt: n(o.expiresAt),
    paidAt: n(o.paidAt),
    fulfilledAt: n(o.fulfilledAt),
  };
}

// ------------------------------------------------------------ the payment page
/** Robokassa's own payment page — the only address a purchase ever leaves the game for. */
export const PAYMENT_GATEWAY = 'https://auth.robokassa.ru/Merchant/Index.aspx';

const FIELD_RE = /^(MerchantLogin|OutSum|InvId|Description|SignatureValue|IsTest|Culture|Encoding|ExpirationDate|Receipt|Email|Shp_[A-Za-z0-9_]{1,40})$/;
const REQUIRED = ['MerchantLogin', 'OutSum', 'InvId', 'SignatureValue'];

/**
 * The payment page the server sent — only if it goes to Robokassa and carries nothing but Robokassa's
 * fields. `devLocal`: a development build also accepts the local emulator on 127.0.0.1 (the UI checks);
 * production builds pass false (import.meta.env.DEV), so they leave only for Robokassa.
 */
export function checkPaymentPage(v: unknown, devLocal = false): PaymentPage | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as Record<string, unknown>;
  const url = typeof p.url === 'string' ? p.url : '';
  const okUrl = url === PAYMENT_GATEWAY || (devLocal && /^http:\/\/127\.0\.0\.1:[0-9]{2,5}\/[A-Za-z0-9_/.-]*$/.test(url));
  if (!okUrl || p.method !== 'POST' || !p.fields || typeof p.fields !== 'object') return null;
  const fields: Record<string, string> = {};
  for (const [k, val] of Object.entries(p.fields as Record<string, unknown>)) {
    if (!FIELD_RE.test(k) || typeof val !== 'string' || val.length > 4000) return null;
    fields[k] = val;
  }
  if (!REQUIRED.every((k) => fields[k])) return null;
  return { url, method: 'POST', fields };
}

// ------------------------------------------------------------ what an order means on screen
/**
 *   checking    not paid yet, the player has just come back from a payment (the game keeps asking a little)
 *   unpaid      not paid (the payment was not finished, or the player opened an older order)
 *   delivering  paid, the item is being delivered (a moment; the server retries a failed step itself)
 *   done        delivered AND in the server's list of this account's rights — the only «success»
 *   closed      not paid in time / refused by Robokassa: nothing granted
 *   review      the server keeps it for the administrator (a second payment, another amount…)
 *   refund      a refund is under way or done
 */
export type OrderPhase = 'checking' | 'unpaid' | 'delivering' | 'done' | 'closed' | 'review' | 'refund';

export function orderPhase(o: ServerOrder, owned: readonly string[], cameBackPaid: boolean): OrderPhase {
  switch (o.status) {
    case 'fulfilled':
      return owned.includes(o.sku) ? 'done' : 'delivering';
    case 'paid':
      return 'delivering';
    case 'pending_payment':
      return cameBackPaid ? 'checking' : 'unpaid';
    case 'failed':
    case 'expired':
    case 'canceled':
      return 'closed';
    case 'refund_pending':
    case 'refunded':
      return 'refund';
    default:
      return 'review';
  }
}

/** How long the game keeps asking after the player came back: these pauses (~47 s), then «проверим позже». */
export const POLL_DELAYS_MS = [1500, 2000, 2500, 3000, 4000, 5000, 6000, 8000, 15000];

/** The phases worth asking again (the answer can still change by itself). */
export function keepChecking(p: OrderPhase): boolean {
  return p === 'checking' || p === 'delivering';
}

// ------------------------------------------------------------ the way back from Robokassa
/**
 * A short note in sessionStorage (this tab): the order the player left to pay, then how they came back.
 * The order number and the item only — never a price, a signature, a token or ownership.
 */
export interface PayReturn {
  v: 1;
  inv: number;
  /** The item (null: came back on another tab without the note — the server's order names it). */
  sku: ShopSku | null;
  /** The PRIME ID the order was made with (only to notice another account on the way back). */
  account: string | null;
  at: number;
  /** left: gone to Robokassa; success / fail: came back through Robokassa's SuccessURL / FailURL. */
  result: 'left' | 'success' | 'fail';
}

export const PAY_RETURN_KEY = 'primetime-showdown-pay-v1';
/** An order lives two hours (the server's ORDER_TTL_MS); the note a little longer, then it is dropped. */
export const PAY_RETURN_TTL_MS = 3 * 3600 * 1000;

/**
 * 1.8.9: how many times this tab tried to open Robokassa's page for one order. After PAY_TRIES_MAX tries in
 * PAY_TRIES_WINDOW_MS the window stops offering another try (no endless loop when the page cannot open from
 * the player's network) and only checks the order; the count lives in sessionStorage, so a reload keeps it.
 */
export const PAY_TRIES_KEY = 'primetime-showdown-pay-tries-v1';
export const PAY_TRIES_MAX = 3;
export const PAY_TRIES_WINDOW_MS = 10 * 60 * 1000;

interface MiniStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export function saveReturn(store: MiniStorage | null, r: Omit<PayReturn, 'v'>): void {
  try {
    store?.setItem(PAY_RETURN_KEY, JSON.stringify({ v: 1, inv: r.inv, sku: r.sku, account: r.account, at: r.at, result: r.result }));
  } catch {
    /* storage blocked: the shop still lists the open order (the server keeps it) */
  }
}

/** The tries this tab made for order `inv` within the window (0 for another order or after the window). */
export function triesOf(store: MiniStorage | null, inv: number, now: number = Date.now()): number {
  try {
    const v: unknown = JSON.parse(store?.getItem(PAY_TRIES_KEY) ?? 'null');
    if (!v || typeof v !== 'object') return 0;
    const t = v as Record<string, unknown>;
    const n = typeof t.n === 'number' && Number.isFinite(t.n) ? Math.max(0, Math.floor(t.n)) : 0;
    const last = typeof t.last === 'number' && Number.isFinite(t.last) ? t.last : 0;
    return t.inv === inv && now - last < PAY_TRIES_WINDOW_MS && last <= now + 60000 ? n : 0;
  } catch {
    return 0;
  }
}

/** One more try for order `inv` (a new order starts from 1); the count after it. */
export function noteTry(store: MiniStorage | null, inv: number, now: number = Date.now()): number {
  const n = triesOf(store, inv, now) + 1;
  try {
    store?.setItem(PAY_TRIES_KEY, JSON.stringify({ v: 1, inv, n, last: now }));
  } catch {
    /* storage blocked: the window still counts while it is open */
  }
  return n;
}

export function clearReturn(store: MiniStorage | null): void {
  try {
    store?.removeItem(PAY_RETURN_KEY);
  } catch {
    /* nothing to clear */
  }
}

/** The note, if well-formed, fresh and about a real item; anything else is dropped. */
export function loadReturn(store: MiniStorage | null, now: number = Date.now()): PayReturn | null {
  let raw: string | null = null;
  try {
    raw = store?.getItem(PAY_RETURN_KEY) ?? null;
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
    typeof p.inv === 'number' &&
    Number.isInteger(p.inv) &&
    p.inv > 0 &&
    (p.sku === null || (typeof p.sku === 'string' && SHOP_ITEMS.some((i) => i.sku === p!.sku))) &&
    (p.account === null || (typeof p.account === 'string' && p.account.length <= 64)) &&
    typeof p.at === 'number' &&
    now - p.at >= 0 &&
    now - p.at <= PAY_RETURN_TTL_MS &&
    (p.result === 'left' || p.result === 'success' || p.result === 'fail');
  if (!ok) {
    clearReturn(store);
    return null;
  }
  return p as unknown as PayReturn;
}

/** ?prime_pay=success|fail&inv=N — what the server's SuccessURL / FailURL put in the game's address. */
export function readReturnQuery(search: string): { result: 'success' | 'fail'; inv: number | null } | null {
  let q: URLSearchParams;
  try {
    q = new URLSearchParams(search);
  } catch {
    return null;
  }
  const r = q.get('prime_pay');
  if (r !== 'success' && r !== 'fail') return null;
  const inv = q.get('inv') ?? '';
  return { result: r, inv: /^[1-9][0-9]{0,14}$/.test(inv) ? Number(inv) : null };
}

/** The address without those two parameters (shown after the game read them; nothing else changes). */
export function stripReturnQuery(href: string): string {
  try {
    const u = new URL(href);
    u.searchParams.delete('prime_pay');
    u.searchParams.delete('inv');
    return u.pathname + (u.searchParams.toString() ? '?' + u.searchParams.toString() : '') + u.hash;
  } catch {
    return href;
  }
}

/**
 * The note once the player is back: Robokassa's way back (the address) sets success / fail. With the note
 * of this tab, the number must be the order the game sent them to pay; without it (another tab) the number
 * alone is followed — the server shows an order only to its own PRIME ID. Without the address (the Back
 * button, a reload) the note stays «left»: the game checks the order once.
 */
export function mergeReturn(note: PayReturn | null, q: { result: 'success' | 'fail'; inv: number | null } | null, now: number = Date.now()): PayReturn | null {
  if (!q) return note;
  if (!note) return q.inv !== null ? { v: 1, inv: q.inv, sku: null, account: null, at: now, result: q.result } : null;
  if (q.inv !== null && q.inv !== note.inv) return { v: 1, inv: q.inv, sku: null, account: note.account, at: now, result: q.result };
  return { ...note, result: q.result, at: now };
}

// ------------------------------------------------------------ other tabs of the game
/**
 * «Look at order N again» between tabs of this site (the payment may be finished in a NEW tab while the first
 * one still shows the order). The signal carries no status and grants nothing: every tab asks the server.
 */
const SIGNAL_CHANNEL = 'primetime-showdown-pay';
const SIGNAL_KEY = 'primetime-showdown-pay-signal';

export function signalOrder(inv: number): void {
  try {
    const bc = new BroadcastChannel(SIGNAL_CHANNEL);
    bc.postMessage({ inv });
    bc.close();
  } catch {
    /* no BroadcastChannel: the storage event below still reaches the other tabs */
  }
  try {
    localStorage.setItem(SIGNAL_KEY, JSON.stringify({ inv, at: Date.now() }));
  } catch {
    /* storage blocked: the other tab checks when the player looks at it again */
  }
}

/** Listen for those signals (both ways a browser offers); returns the way to stop. */
export function onOrderSignal(fn: (inv: number) => void): () => void {
  const stops: (() => void)[] = [];
  const take = (v: unknown) => {
    const inv = v && typeof v === 'object' ? (v as Record<string, unknown>).inv : undefined;
    if (typeof inv === 'number' && Number.isInteger(inv) && inv > 0) fn(inv);
  };
  try {
    const bc = new BroadcastChannel(SIGNAL_CHANNEL);
    bc.onmessage = (e: MessageEvent) => take(e.data);
    stops.push(() => bc.close());
  } catch {
    /* none */
  }
  try {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SIGNAL_KEY || !e.newValue) return;
      try {
        take(JSON.parse(e.newValue));
      } catch {
        /* not ours */
      }
    };
    window.addEventListener('storage', onStorage);
    stops.push(() => window.removeEventListener('storage', onStorage));
  } catch {
    /* no window (the checks) */
  }
  return () => stops.forEach((s) => s());
}

/** Support (the official contact of the published PRIME ID documents). */
export const SUPPORT_EMAIL = 'primetimeshowdown.official@gmail.com';
