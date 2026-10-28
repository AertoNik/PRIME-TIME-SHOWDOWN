import { COSMETICS } from '../config/cosmetics.config';
import { FIGHTERS } from '../config/fighters';
import { currentOffer, offerDate } from '../config/offer.config';
import { SHOP_SALES_OPEN, SKINS, SHOP_ITEMS, formatKop, rubToKop, type ShopItemDef, type ShopSku } from '../config/shop.config';
import type { Game } from '../game/Game';
import { CLIENT_PAYMENTS, buildCheckout, maskEmail, savePending, sessionStore, type CheckoutAccount, type CheckoutBlock, type CheckoutInput, type CheckoutView } from '../meta/Checkout';
import { PAY_TRIES_MAX, POLL_DELAYS_MS, TEST_PAY_BAND, checkPaymentPage, isTestPay, keepChecking, noteTry, onOrderSignal, orderPhase, saveReturn, signalOrder, triesOf, type OrderPhase, type PayEnv, type PaymentPage, type ServerOrder } from '../meta/Payments';
import { PrimeApiError, type CheckoutStart, type ShopServerStatus } from '../net/PrimeApi';
import { accountAction, openLogin, openRegister } from './accountUI';
import { issueOfError, orderBodyHTML, orderFoot, orderStatus, type OrderIssue, type OrderView } from './checkoutOrder';
import { openOfferDoc } from './legalUI';
import { DEV_SCENARIO_DEFAULT, applyDevScenario, devOrderView, devPanelHTML, devScenarioTap, type DevScenario } from './checkoutPreview';
import { esc, el } from './dom';
import { UI_ICONS } from './icons';
import { nameHTML, shopArt } from './shopArt';

// Alpha 1.8.8 (stage 3) — PRIME CHECKOUT: the purchase window of PRIME SHOP. One window at a time, a
// real dialog (focus kept inside, Esc closes, focus goes back to the button that opened it).
//
// It shows the item, the price, the PRIME ID the purchase belongs to, the public offer and the one
// action that makes sense now. What may happen is decided by buildCheckout (src/meta/Checkout.ts) and,
// for a signed-in account, by the server (/api/prime/shop/status). While prices are not approved,
// sales are closed, the offer is not published or payments are not connected, the window explains
// that and nothing can be bought.
//
// 1.8.8 stage 4 — PRIME PAYMENTS: «Перейти к оплате» asks the server for the order (the server records the
// consent, checks everything again, makes the order or gives back the open one and signs Robokassa's page);
// the window checks the page goes to Robokassa and sends the player there. Back from Robokassa (or opened
// for an open order) the window follows THE ORDER (checkoutOrder.ts): it asks the server a few times, then
// says «загляните позже». «ПОКУПКА ПОДТВЕРЖДЕНА» only when the server's order is fulfilled and the item is
// in the server's list of this PRIME ID's rights — the window never grants anything itself.

const RARITY: Record<ShopItemDef['rarity'], string> = { rare: 'Редкий', epic: 'Эпический', legendary: 'Легендарный' };

/** Development builds only (`?checkoutpreview`): the test scenario panel (see checkoutPreview.ts). */
const DEV_PREVIEW = import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).has('checkoutpreview');

/** The PRIME ID this page would buy with, from the accounts layer as it stands. */
export function checkoutAccount(g: Game): CheckoutAccount {
  const r = g.account;
  if (!r) return { state: 'none', id: null, nickname: '', email: '' };
  const v = r.view();
  const api = r.api;
  const rec = api?.sessionRecord ?? null;
  const me = r.me;
  const id = me?.id ?? rec?.id ?? null;
  const who = (state: CheckoutAccount['state']): CheckoutAccount => ({
    state,
    id,
    nickname: me?.nickname ?? (id ? r.nickname(id) : ''),
    email: maskEmail(me?.email ?? rec?.email ?? ''),
  });
  switch (v.kind) {
    case 'starting':
      return who('connecting');
    case 'server-down':
      return who('offline');
    case 'guest':
      // a stored session that is no longer valid: «sign in again», not a stranger
      return rec && !api?.signedIn ? who('expired') : { state: 'guest', id: null, nickname: '', email: '' };
    case 'unverified':
      return who('unverified');
    case 'not-loaded':
      if (!api?.signedIn) return who('expired');
      return r.legalNeeds().length ? who('terms') : who('ready');
    case 'account':
      if (!v.signedIn || v.gate === 'signed-out') return who('expired');
      if (v.gate === 'terms') return who('terms');
      if (v.gate === 'superseded') return who('elsewhere');
      if (v.gate === 'offline') return who('offline');
      return who('ready');
  }
}

/** A refusal code of the server → the reason the window shows. */
const SERVER_BLOCK: Record<string, CheckoutBlock> = {
  unknown_item: 'unavailable',
  not_verified: 'unverified',
  legal_required: 'legal_required',
  adult_only: 'adult_only',
  owned: 'owned',
  seasonal_only: 'seasonal_only',
  price_pending: 'price_pending',
  sales_closed: 'sales_closed',
  offer_missing: 'offer_missing',
  offer_unavailable: 'offer_missing',
  payments_unavailable: 'payments_unavailable',
  receipt_required_for_live: 'payments_unavailable',
  too_many_orders: 'rate_limited',
  ledger_unavailable: 'server_unavailable',
  order_failed: 'server_unavailable',
};

interface Info {
  title: string;
  text: string;
  tone: 'wait' | 'warn' | 'lock' | 'ok';
}

const ICON = {
  diamond: `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M18 8 H46 L58 24 L32 58 L6 24 Z" fill="currentColor" opacity=".25"/><path d="M18 8 H46 L58 24 L32 58 L6 24 Z M6 24 H58 M24 8 L18 24 L32 58 L46 24 L40 8" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"/></svg>`,
  lock: `<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="13" y="28" width="38" height="28" rx="7" fill="currentColor"/><path d="M21 28 V20 C21 7 43 7 43 20 V28" fill="none" stroke="currentColor" stroke-width="6"/></svg>`,
  id: `<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="6" y="12" width="52" height="40" rx="9" fill="none" stroke="currentColor" stroke-width="4.5"/><circle cx="23" cy="30" r="7" fill="currentColor"/><path d="M12 46 C14 38 32 38 34 46" fill="currentColor"/><path d="M40 26 H50 M40 34 H50" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>`,
  doc: `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M16 6 H40 L50 16 V58 H16 Z" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linejoin="round"/><path d="M24 28 H42 M24 37 H42 M24 46 H36" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>`,
  close: `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M16 16 L48 48 M48 16 L16 48" stroke="currentColor" stroke-width="7" stroke-linecap="round"/></svg>`,
};

/**
 * The window. ShopScreen owns one: `open(sku)` shows it (again, if it is open), `close()` hides it.
 * Leaving for PRIME ID (sign in / create an account / sign in again) writes the short «back to the
 * item» note first and tells the shop to watch for the sign-in (`onAwaitSignIn`).
 */
export class PrimeCheckout {
  private g: Game;
  private root: HTMLElement | null = null;
  private dialog: HTMLElement | null = null;
  private sku: ShopSku | null = null;
  private from: 'menu' | 'collection' = 'menu';
  private startedFor: string | null | undefined = undefined;
  private opener: HTMLElement | null = null;
  private ticked = false;
  /** The server's answer for this window (null: not asked or not reachable). */
  private server: ShopServerStatus | null = null;
  private serverIssue: 'offline' | 'expired' | null = null;
  private serverBlock: CheckoutBlock | null = null;
  private checking = false;
  private busy = false;
  private unsub: (() => void) | null = null;
  private dev: DevScenario = DEV_SCENARIO_DEFAULT;
  // 1.8.8 stage 4: the order this window follows (null: the purchase itself is shown)
  private orderInv: number | null = null;
  private order: ServerOrder | null = null;
  private orderOwned: string[] = [];
  private orderIssue: OrderIssue = null;
  /** Came back from Robokassa through SuccessURL (keep asking a little) / FailURL. */
  private orderReturn: 'success' | 'fail' | null = null;
  private pollStep = 0;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private slow = false;
  private leaving = false;
  private leaveTimer: ReturnType<typeof setTimeout> | null = null;
  private celebrated = false;
  /** The signed payment page last sent (to open it again in a new tab without asking the server). */
  private lastPayment: PaymentPage | null = null;
  /** Robokassa's page was opened in a new tab from here. */
  private elsewhere = false;
  /** 1.8.9: the server's code behind the order's issue «refused» / «paused». */
  private orderIssueCode = '';
  /** 1.8.9: the page was fetched again for a new tab; the player's next tap opens it. */
  private prepared = false;
  /** 1.8.9: when Robokassa's page was last sent from here (a second tap a moment later is ignored). */
  private lastLeaveAt = 0;
  /** 1.8.9: tries for the order also counted here (sessionStorage may be blocked). */
  private triesMem: { inv: number; n: number } | null = null;
  private unsubSignal: (() => void) | null = null;
  private lastPollAt = 0;
  /**
   * The player looks at this tab again (back from Robokassa in another tab, or the page never left): ask the
   * server about the order once — never on a guess, never endlessly.
   */
  private onVisible = () => {
    if (document.visibilityState !== 'visible' || this.orderInv === null || !this.root) return;
    if (this.leaving) {
      // still here: the payment page did not replace this one (another tab, or it did not open)
      if (this.leaveTimer) clearTimeout(this.leaveTimer);
      this.leaveTimer = null;
      this.leaving = false;
    }
    this.recheckSoon();
  };
  private onPageShow = (e: PageTransitionEvent) => {
    // back from Robokassa with the browser's Back button (the page was kept in memory): check the order
    if (!e.persisted || !this.leaving || this.orderInv === null) return;
    this.leaving = false;
    this.startPolling(false);
  };
  private onPageHide = () => {
    if (this.leaveTimer) clearTimeout(this.leaveTimer);
    this.leaveTimer = null;
  };
  /** The shop starts watching for the end of a PRIME ID sign-in. */
  onAwaitSignIn: () => void = () => {};

  constructor(g: Game) {
    this.g = g;
  }

  get isOpen(): boolean {
    return this.root !== null;
  }

  /** Show the window for `sku` (one window: an open one is reused). */
  open(sku: ShopSku, o: { opener?: HTMLElement | null; from?: 'menu' | 'collection'; startedFor?: string | null } = {}): void {
    if (!SHOP_ITEMS.some((i) => i.sku === sku)) return;
    const fresh = this.sku !== sku || !this.root;
    this.sku = sku;
    this.from = o.from ?? this.from;
    this.startedFor = o.startedFor;
    if (fresh || this.orderInv !== null) {
      this.ticked = false;
      this.server = null;
      this.serverIssue = null;
      this.serverBlock = null;
    }
    this.leaveOrder();
    if (!this.root) {
      this.opener = o.opener ?? (document.activeElement as HTMLElement | null);
      this.mount();
    }
    this.render();
    this.dialog?.focus({ preventScroll: true });
    void this.verify();
  }

  /**
   * 1.8.8 stage 4: follow an order (back from Robokassa, or an open order of the shop): `result` — how the
   * player came back (success: keep asking a little; fail: ask once; null: ask once). The item may be unknown
   * (another tab): the server's order names it.
   */
  openOrder(inv: number, o: { sku?: ShopSku | null; result?: 'success' | 'fail' | 'left' | null; opener?: HTMLElement | null; from?: 'menu' | 'collection' } = {}): void {
    if (o.sku && SHOP_ITEMS.some((i) => i.sku === o.sku)) this.sku = o.sku;
    this.from = o.from ?? this.from;
    this.leaveOrder();
    this.orderInv = inv;
    this.orderReturn = o.result === 'success' || o.result === 'fail' ? o.result : null;
    if (!this.root) {
      this.opener = o.opener ?? (document.activeElement as HTMLElement | null);
      this.mount();
    }
    this.watchSignals();
    this.startPolling(true);
    this.dialog?.focus({ preventScroll: true });
  }

  /** Another tab of the game saw this order change: check it here too (the server decides, not the message). */
  private watchSignals(): void {
    this.unsubSignal?.();
    this.unsubSignal = onOrderSignal((inv) => {
      if (inv === this.orderInv) this.recheckSoon();
    });
  }

  /** One check now unless one ran a moment ago or is already scheduled (the cycle continues by itself). */
  private recheckSoon(): void {
    if (this.orderInv === null || this.pollTimer || Date.now() - this.lastPollAt < 1500) return;
    void this.poll();
  }

  /** Back to the purchase itself (or closing): the order's timers stop. */
  private leaveOrder(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.leaveTimer) clearTimeout(this.leaveTimer);
    this.unsubSignal?.();
    this.unsubSignal = null;
    this.elsewhere = false;
    this.lastPayment = null;
    this.prepared = false;
    this.orderIssueCode = '';
    this.pollTimer = null;
    this.leaveTimer = null;
    this.orderInv = null;
    this.order = null;
    this.orderOwned = [];
    this.orderIssue = null;
    this.orderReturn = null;
    this.slow = false;
    this.leaving = false;
    this.celebrated = false;
  }

  /** Hide it. Nothing is saved or changed; focus goes back to the button that opened it. */
  close(restoreFocus = true): void {
    if (!this.root) return;
    this.leaveOrder();
    window.removeEventListener('pageshow', this.onPageShow);
    window.removeEventListener('pagehide', this.onPageHide);
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('focus', this.onVisible);
    this.unsub?.();
    this.unsub = null;
    this.root.remove();
    this.root = null;
    this.dialog = null;
    this.lastHTML = '';
    this.busy = false;
    this.checking = false;
    const back = this.opener;
    this.opener = null;
    if (restoreFocus && back && back.isConnected) back.focus({ preventScroll: true });
  }

  private mount(): void {
    const root = el('div', 'pco-root');
    root.innerHTML = `<section class="pco" role="dialog" aria-modal="true" aria-labelledby="pco-title" aria-describedby="pco-state" tabindex="-1"></section>`;
    this.root = root;
    this.dialog = root.querySelector('.pco') as HTMLElement;
    root.addEventListener('click', (e) => {
      if (e.target === root) return this.close();
      const t = (e.target as HTMLElement).closest('[data-pco],[data-dev]') as HTMLElement | null;
      if (!t) return;
      // the terms open in a sheet over this window (never a new tab, never ticking the consent box)
      if (t.dataset.pco === 'doc') e.preventDefault();
      if (DEV_PREVIEW && t.dataset.dev) {
        const next = devScenarioTap(this.dev, t);
        if (next) {
          this.dev = next;
          this.ticked = false;
          this.render();
        }
        return;
      }
      this.act(t.dataset.pco!, t);
    });
    root.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.pco !== 'consent') return;
      this.ticked = t.checked;
      this.renderFoot();
    });
    root.addEventListener('keydown', (e) => this.onKey(e));
    this.g.ui.root.appendChild(root);
    window.addEventListener('pageshow', this.onPageShow);
    window.addEventListener('pagehide', this.onPageHide);
    document.addEventListener('visibilitychange', this.onVisible);
    window.addEventListener('focus', this.onVisible);
    // the account changes under the open window (signed in elsewhere, session ended, documents…)
    this.unsub = this.g.account?.onChange(() => {
      if (!this.root) return;
      this.render();
    }) ?? null;
  }

  /** Esc closes; Tab stays inside the window. */
  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.stopPropagation();
      this.close();
      return;
    }
    if (e.key !== 'Tab' || !this.dialog) return;
    const items = Array.from(this.dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), summary')).filter((x) => x.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === this.dialog)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // ---------------------------------------------------------------- the data
  private input(): CheckoutInput {
    const g = this.g;
    const item = SHOP_ITEMS.find((i) => i.sku === this.sku)!;
    const s = this.server;
    let account = checkoutAccount(g);
    // what the server found is newer than the page's picture of the account
    if (this.serverIssue === 'expired') account = { ...account, state: 'expired' };
    else if (this.serverIssue === 'offline' && account.state === 'ready') account = { ...account, state: 'offline' };
    else if (s && account.state === 'ready') {
      if (!s.verified) account = { ...account, state: 'unverified' };
      else if (s.legalNeeds.length) account = { ...account, state: 'terms' };
    }
    const local = currentOffer();
    // 1.8.8 stage 4: what the payment asks (kopecks) once the server answered; Robokassa's test mode (a staging
    // server, the demonstration) opens its own test sales — the item's official price is shown beside it
    const env = this.payEnv();
    const kop = s?.pricesKop ? (s.pricesKop[item.sku] ?? null) : isTestPay(env) ? g.shop.chargeKop(item.sku) : g.shop.priceKop(item.sku);
    let input: CheckoutInput = {
      sku: item.sku,
      state: g.shop.state(item),
      priceRub: kop === null ? null : kop / 100,
      salesOpen: s ? (isTestPay(s.env) ? s.sales : SHOP_SALES_OPEN && s.sales) : SHOP_SALES_OPEN,
      // the server's revision wins: it is the one it will accept
      offer: s?.offer ?? local,
      account,
      startedFor: this.startedFor,
      acceptedRevision: s?.acceptedRevision ?? 0,
      paymentsReady: CLIENT_PAYMENTS && !!s?.payments,
      consentTicked: this.ticked,
    };
    if (DEV_PREVIEW) input = applyDevScenario(input, this.dev);
    return input;
  }

  private view(): CheckoutView {
    const v = buildCheckout(this.input());
    // a refusal the server gave for this item (stage 4 shows it after «Перейти к оплате»)
    if (!v.block && this.serverBlock) return { ...v, block: this.serverBlock, canPay: false };
    return v;
  }

  /**
   * Ask the server (signed in, the item could be sold): it confirms the session, the email, the
   * documents, the offer and this account's consent, sales and payments. Never in the test preview,
   * never for an item that cannot be sold anyway (no price, sales closed, no offer) — so in 1.8.8
   * stage 3 nothing is asked at all.
   */
  private async verify(): Promise<void> {
    const g = this.g;
    const api = g.account?.api;
    const cfg = g.account?.serverConfig;
    if (DEV_PREVIEW || !api || !cfg?.shopCheckout || this.checking || this.orderInv !== null) return;
    if (checkoutAccount(g).state === 'guest' || checkoutAccount(g).state === 'none') return;
    // a stage-3 server (no payments): asked only when the item could be sold at all. A stage-4 server knows
    // the prices, sales and payments of its own mode (a staging server sells test payments): always asked.
    if (!cfg.shopPayments) {
      const gate = buildCheckout({ ...this.input(), paymentsReady: true }).block;
      if (gate && gate !== 'session_expired' && gate !== 'unverified' && gate !== 'legal_required' && gate !== 'offline' && gate !== 'account_changed') return;
    }
    this.checking = true;
    this.render();
    try {
      this.server = await api.shopStatus();
      this.serverIssue = null;
      // the server's list of this account's rights comes along: the window and the shop agree with it
      if (cfg.shopPayments) g.account?.applyRights(this.server.owned);
    } catch (e) {
      this.serverIssue = e instanceof PrimeApiError && e.kind === 'unauthorized' ? 'expired' : 'offline';
    }
    this.checking = false;
    if (this.root) this.render();
  }

  // ---------------------------------------------------------------- actions
  private act(a: string, t: HTMLElement): void {
    const g = this.g;
    // the test preview pretends an account state: its PRIME ID buttons only say what would happen
    if (DEV_PREVIEW && this.dev.account !== 'live' && ['login', 'register', 'verified', 'resend', 'terms', 'here', 'retry'].includes(a)) {
      g.ui.toast('Тестовый предпросмотр: в игре здесь откроется PRIME ID');
      return;
    }
    if (!g.account && ['login', 'register', 'verified', 'resend', 'terms', 'here'].includes(a)) return;
    if (DEV_PREVIEW && this.dev.order !== 'none' && ['repay', 'recheck', 'anew', 'login'].includes(a)) {
      g.ui.toast('Тестовый предпросмотр: в игре здесь будет запрос к PRIME NETWORK');
      return;
    }
    switch (a) {
      case 'close':
      case 'back':
        g.audio.ui('click');
        return this.close();
      case 'noop':
      case 'support':
        return;
      case 'doc': {
        const o = this.view().offer;
        if (o) openOfferDoc(g, o);
        return;
      }
      case 'repay':
        void this.pay(true);
        return;
      case 'newtab':
        this.openPaymentNewTab();
        return;
      case 'prepare':
        void this.pay(true, true);
        return;
      case 'recheck':
        g.audio.ui('click');
        this.startPolling(false);
        return;
      case 'anew':
        // the order is closed: back to the purchase (everything is checked again)
        g.audio.ui('click');
        this.leaveOrder();
        this.server = null;
        this.ticked = false;
        this.render();
        void this.verify();
        return;
      case 'later':
        // «Пока не сейчас»: back to the item; no note is kept
        g.audio.ui('click');
        return this.close();
      case 'login':
      case 'register':
        g.audio.ui('confirm');
        if (this.orderInv !== null && this.sku) {
          // following an order: after signing in the window comes back to it (the shop watches)
          saveReturn(sessionStore(), { inv: this.orderInv, sku: this.sku, account: null, at: Date.now(), result: this.orderReturn ?? 'left' });
          this.close(false);
          this.onAwaitSignIn();
          openLogin(g);
          return;
        }
        this.leaveForSignIn();
        if (a === 'login') openLogin(g);
        else openRegister(g);
        return;
      case 'verified':
        // «Я подтвердил»: the sign-in continues (it may reload the page — the note brings the player back)
        this.remember();
        this.onAwaitSignIn();
        accountAction(g, 'verified');
        return;
      case 'resend':
        accountAction(g, 'resend');
        return;
      case 'terms':
        g.audio.ui('click');
        g.account?.askTerms(true);
        return;
      case 'here':
        g.audio.ui('click');
        this.remember();
        g.account?.continueHere();
        return;
      case 'retry':
        g.audio.ui('click');
        this.serverIssue = null;
        this.serverBlock = null;
        if (g.account && g.account.serverUp === false) void g.account.recheckServer().then(() => this.verify());
        else void this.verify();
        this.render();
        return;
      case 'restart':
        g.audio.ui('click');
        this.startedFor = undefined;
        this.ticked = false;
        this.server = null;
        this.serverBlock = null;
        this.render();
        void this.verify();
        return;
      case 'collection':
        g.audio.ui('click');
        this.close(false);
        // the wardrobe («Облики бойцов») and the cosmetics are on this tab
        g.goto('collection', { tab: 'cosmetics' });
        return;
      case 'roster':
        g.audio.ui('click');
        this.close(false);
        g.goto('roster', t.dataset.f);
        return;
      case 'events':
        g.audio.ui('click');
        this.close(false);
        g.goto('events');
        return;
      case 'pay':
        void this.pay();
        return;
    }
  }

  /** The note that brings the player back to this item after PRIME ID (sessionStorage, this tab). */
  private remember(): void {
    if (!this.sku) return;
    savePending(sessionStore(), { sku: this.sku, from: this.from, step: 'checkout', at: Date.now(), account: checkoutAccount(this.g).id });
  }

  private leaveForSignIn(): void {
    this.remember();
    this.close(false);
    this.onAwaitSignIn();
  }

  /**
   * «Перейти к оплате» (pressable only when canPay) — or `again` for an order that is followed already
   * («Повторить / Продолжить оплату»: the server gives back the SAME open order, never a second one). The
   * consent to the current offer is recorded by the server first; then the server checks everything again,
   * makes the order and signs Robokassa's page. The window only sends the player there; only the server's
   * confirmation of the payment can make an item owned.
   */
  private async pay(again = false, prepareOnly = false): Promise<void> {
    if (this.busy || !this.sku) return;
    // 1.8.9: a followed order out of tries — only checking it (no endless loop)
    if (again && this.orderInv !== null && this.triesLeft(this.orderInv) <= 0) return this.render();
    const v = this.view();
    if (!again && !v.canPay) return;
    const g = this.g;
    if (DEV_PREVIEW) {
      g.ui.toast('Тестовый предпросмотр: оплата не выполняется, заказ не создаётся');
      return;
    }
    const api = g.account?.api;
    if (!api) return;
    this.busy = true;
    this.orderIssue = null;
    this.renderFoot();
    let start: CheckoutStart | null = null;
    try {
      if (!again && v.offer && v.consent !== 'accepted' && this.ticked) {
        const accepted = await api.acceptOffer(v.offer.revision, v.offer.sha256, 'ru');
        if (this.server) this.server = { ...this.server, acceptedRevision: accepted };
      }
      start = await api.startCheckout(this.sku);
    } catch (e) {
      const code = e instanceof PrimeApiError ? e.code : '';
      if (again && this.orderInv !== null && code !== 'offer_changed' && code !== 'offer_consent_required') {
        // 1.8.9: another try refused — stay on the order (it is kept on the server), say why, keep «Проверить статус»
        this.busy = false;
        if (code === 'owned') return this.startPolling(false);
        this.orderIssue = e instanceof PrimeApiError ? issueOfError(e.kind, e.code) : 'refused';
        this.orderIssueCode = code;
        this.prepared = false;
        return this.render();
      }
      // anything refused: back to the purchase itself, which explains it (an order stays on the server)
      if (again) this.leaveOrder();
      if (e instanceof PrimeApiError) {
        if (e.kind === 'unauthorized') this.serverIssue = 'expired';
        else if (e.kind === 'network' && e.code === 'timeout') this.serverBlock = 'server_unavailable';
        else if (e.kind === 'network') this.serverIssue = 'offline';
        else if (e.code === 'offer_changed' || e.code === 'offer_consent_required') {
          this.ticked = false;
          this.server = null;
          void this.verify();
        } else {
          if (e.code === 'too_many_orders') g.ui.toast('Слишком много заказов за час — попробуйте немного позже');
          this.serverBlock = SERVER_BLOCK[e.code] ?? (e.kind === 'rate' ? 'rate_limited' : e.kind === 'server' ? 'server_unavailable' : 'payments_unavailable');
        }
      } else this.serverBlock = 'payments_unavailable';
    } finally {
      this.busy = false;
    }
    if (start && prepareOnly) this.preparePayment(start);
    else if (start) this.goToPayment(start);
    else if (this.root) this.render();
  }

  /** 1.8.9: tries left to open Robokassa's page for order `inv` from this tab. */
  private triesLeft(inv: number): number {
    const mem = this.triesMem && this.triesMem.inv === inv ? this.triesMem.n : 0;
    return Math.max(0, PAY_TRIES_MAX - Math.max(mem, triesOf(sessionStore(), inv)));
  }

  /** 1.8.9: one more try to open Robokassa's page for `inv` (counted in sessionStorage and here). */
  private countTry(inv: number): void {
    const stored = noteTry(sessionStore(), inv);
    const mem = this.triesMem && this.triesMem.inv === inv ? this.triesMem.n + 1 : 1;
    this.triesMem = { inv, n: Math.max(stored, mem) };
    this.lastLeaveAt = Date.now();
  }

  /**
   * 1.8.9: «Подготовить оплату в новой вкладке» — the server gave the order's signed page again (the same open
   * order); nothing is opened yet: a tab opened after a request would be blocked (iPhone Safari), so the
   * player's next tap opens it (openPaymentNewTab, inside that tap).
   */
  private preparePayment(start: CheckoutStart): void {
    const page: PaymentPage | null = checkPaymentPage(start.payment, import.meta.env.DEV);
    if (start.order.inv !== this.orderInv) {
      // the server answered with another order (the old one closed meanwhile): follow that one
      this.leaveOrder();
      this.orderInv = start.order.inv;
      this.watchSignals();
    }
    this.order = start.order;
    if (!page) {
      this.orderIssue = 'leave_failed';
      return this.render();
    }
    this.lastPayment = page;
    this.prepared = true;
    this.orderIssue = null;
    this.orderIssueCode = '';
    this.render();
  }

  /** The order is there: check Robokassa's page, remember the way back, leave for it. */
  private goToPayment(start: CheckoutStart): void {
    const g = this.g;
    const page: PaymentPage | null = checkPaymentPage(start.payment, import.meta.env.DEV);
    this.leaveOrder();
    this.orderInv = start.order.inv;
    this.order = start.order;
    if (!page) {
      // not Robokassa's page (a misconfigured server): nowhere to go — the order waits on the server
      this.orderIssue = 'leave_failed';
      this.render();
      return;
    }
    // 1.8.9: the same order out of tries (also from the purchase itself, after closing the window): no
    // new attempt — the order screen explains and keeps «Проверить статус»
    if (this.triesLeft(start.order.inv) <= 0) {
      this.lastPayment = page;
      this.watchSignals();
      this.orderIssue = 'leave_failed';
      this.render();
      return;
    }
    saveReturn(sessionStore(), { inv: start.order.inv, sku: this.sku!, account: checkoutAccount(g).id, at: Date.now(), result: 'left' });
    this.countTry(start.order.inv);
    this.prepared = false;
    this.lastPayment = page;
    this.watchSignals();
    this.leaving = true;
    this.render();
    g.audio.ui('confirm');
    const form = this.paymentForm(page, false);
    // still here after a while (the page did not open): say so, offer to try again — the order is kept
    this.leaveTimer = setTimeout(() => {
      this.leaveTimer = null;
      if (!this.root || !this.leaving) return;
      this.leaving = false;
      this.orderIssue = 'leave_failed';
      this.render();
    }, 12000);
    try {
      form.submit();
    } catch {
      this.leaving = false;
      this.orderIssue = 'leave_failed';
      this.render();
    } finally {
      setTimeout(() => form.remove(), 1000);
    }
  }

  /** Robokassa's form (hidden fields as signed by the server); `newTab`: opened in a new tab, without an opener. */
  private paymentForm(page: PaymentPage, newTab: boolean): HTMLFormElement {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = page.url;
    form.acceptCharset = 'UTF-8';
    form.style.display = 'none';
    if (newTab) {
      form.target = '_blank';
      form.rel = 'noopener'; // (no opener; the referrer stays as on the same-tab way)
    }
    for (const [k, val] of Object.entries(page.fields)) {
      const i = document.createElement('input');
      i.type = 'hidden';
      i.name = k;
      i.value = val;
      form.appendChild(i);
    }
    document.body.appendChild(form);
    return form;
  }

  /**
   * «Открыть в новой вкладке»: the SAME signed page (the same invoice — never a second payment) in a new tab,
   * sent right inside the tap (no request first, so the browser does not block it). This tab waits and checks
   * the order when the player comes back, or when the other tab signals.
   */
  private openPaymentNewTab(): void {
    const page = this.lastPayment;
    if (this.orderInv === null) return;
    // 1.8.9: no signed page here (a reload, a return from Robokassa): fetch it first — never a same-tab jump
    // under the «new tab» label; the next tap opens it
    if (!page) return void this.pay(true, true);
    if (this.busy || Date.now() - this.lastLeaveAt < 3000) return;
    if (this.triesLeft(this.orderInv) <= 0) return this.render();
    this.countTry(this.orderInv);
    saveReturn(sessionStore(), { inv: this.orderInv, sku: this.sku, account: checkoutAccount(this.g).id, at: Date.now(), result: 'left' });
    const form = this.paymentForm(page, true);
    try {
      form.submit();
    } finally {
      setTimeout(() => form.remove(), 1000);
    }
    if (this.leaveTimer) clearTimeout(this.leaveTimer);
    this.leaveTimer = null;
    this.leaving = false;
    this.orderIssue = null;
    this.orderIssueCode = '';
    this.prepared = false;
    this.elsewhere = true;
    this.watchSignals();
    this.render();
  }

  // ---------------------------------------------------------------- following an order
  private orderPhaseNow(): OrderPhase | null {
    // back through SuccessURL and still unpaid: «checking» (then «задерживается» once the asking stops —
    // never «продолжить оплату» for a player who believes they paid)
    return this.order ? orderPhase(this.order, this.orderOwned, this.orderReturn === 'success') : null;
  }

  /** Ask the server about the order now and — while the answer can still change by itself — a few times more. */
  private startPolling(fresh: boolean): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
    this.pollStep = 0;
    this.slow = false;
    if (fresh) this.order = null;
    this.render();
    void this.poll();
  }

  private async poll(): Promise<void> {
    // (a timer that fired is spent: recheckSoon may schedule again)
    this.pollTimer = null;
    const inv = this.orderInv;
    if (!this.root || inv === null) return;
    const g = this.g;
    if (DEV_PREVIEW && this.dev.order !== 'none') return this.render();
    const api = g.account?.api;
    if (!api || !api.signedIn) {
      this.orderIssue = 'signin';
      return this.render();
    }
    this.lastPollAt = Date.now();
    try {
      const r = await api.order(inv);
      if (this.orderInv !== inv) return;
      this.order = r.order;
      this.orderOwned = r.owned;
      this.orderIssue = null;
      this.orderIssueCode = '';
      if (!this.sku || this.sku !== r.order.sku) {
        const it = SHOP_ITEMS.find((i) => i.sku === r.order.sku);
        if (it) this.sku = it.sku;
      }
      g.account?.applyRights(r.owned);
    } catch (e) {
      if (this.orderInv !== inv) return;
      this.orderIssue = e instanceof PrimeApiError ? issueOfError(e.kind, e.code) : 'offline';
      this.orderIssueCode = e instanceof PrimeApiError ? e.code : '';
    }
    if (!this.root) return;
    const phase = this.orderPhaseNow();
    if (phase === 'done' && !this.celebrated) {
      this.celebrated = true;
      g.audio.ui('level');
      // the other tabs of the game showing this order check it too (they ask the server themselves)
      signalOrder(inv);
    }
    if (!this.orderIssue && phase && keepChecking(phase)) {
      if (this.pollStep < POLL_DELAYS_MS.length) this.pollTimer = setTimeout(() => void this.poll(), POLL_DELAYS_MS[this.pollStep++]);
      else this.slow = true;
    }
    this.render();
  }

  private orderView(): OrderView | null {
    if (this.orderInv === null || !this.sku) return null;
    const item = SHOP_ITEMS.find((i) => i.sku === this.sku)!;
    if (DEV_PREVIEW && this.dev.order !== 'none') return devOrderView(item, this.dev, this.orderInv);
    return {
      item,
      order: this.order,
      inv: this.orderInv,
      phase: this.orderPhaseNow(),
      issue: this.orderIssue,
      slow: this.slow,
      leaving: this.leaving,
      failReturn: this.orderReturn === 'fail',
      elsewhere: this.elsewhere,
      canNewTab: this.lastPayment !== null,
      prepared: this.prepared,
      triesLeft: this.triesLeft(this.orderInv),
      issueCode: this.orderIssueCode,
      nickname: checkoutAccount(this.g).nickname,
    };
  }

  // ---------------------------------------------------------------- the picture
  private lastHTML = '';

  private render(): void {
    if (!this.dialog) return;
    // 1.8.8 stage 4: following an order (the dev preview's «Заказ» row shows these screens too)
    if (DEV_PREVIEW && this.dev.order !== 'none' && this.orderInv === null && this.sku) this.orderInv = 900000001;
    if (DEV_PREVIEW && this.dev.order === 'none' && this.orderInv === 900000001 && !this.order) this.orderInv = null;
    const ov = this.orderView();
    if (ov) return this.renderOrder(ov);
    if (this.orderInv !== null && !this.sku) return this.renderOrderPending();
    if (!this.sku) return;
    const v = this.view();
    const it = v.item!;
    const html = `
      ${this.headHTML(v)}
      <div class="pco-body">
        ${this.testBand()}
        ${this.itemHTML(v, it)}
        ${this.stateHTML(v)}
        ${this.accountHTML(v)}
        ${this.offerHTML(v)}
        <p class="pco-note">${esc(this.noteText(v))}</p>
        ${DEV_PREVIEW ? devPanelHTML(this.dev) : ''}
      </div>
      <footer class="pco-foot"></footer>`;
    // the account layer reports often (PRIME CLOUD sync): nothing visible changed → nothing redrawn
    if (html === this.lastHTML && this.dialog.childElementCount) return this.renderFoot();
    this.lastHTML = html;
    const keep = (document.activeElement as HTMLElement | null)?.dataset?.pco ?? (document.activeElement as HTMLElement | null)?.dataset?.dev ?? null;
    const scroll = (this.dialog.querySelector('.pco-body') as HTMLElement | null)?.scrollTop ?? 0;
    this.root!.dataset.block = v.block ?? 'none';
    this.dialog.innerHTML = html;
    // the footer first: the body's height (and how far it can scroll) depends on it
    this.renderFoot();
    const body = this.dialog.querySelector('.pco-body') as HTMLElement | null;
    if (body && scroll) body.scrollTop = scroll;
    if (keep) (this.dialog.querySelector(`[data-pco="${keep}"],[data-dev="${keep}"]`) as HTMLElement | null)?.focus({ preventScroll: true });
  }

  /** An order whose item is not known yet (came back on another tab): the first answer names it. */
  private renderOrderPending(): void {
    const html = `${this.headFor({ tone: 'wait', text: 'Проверяем оплату…' })}
      <div class="pco-body"><div class="pco-state is-busy" id="pco-state" data-tone="wait" role="status"><b><i class="pco-spin" aria-hidden="true"></i>Проверяем заказ №${this.orderInv}…</b><span>Спрашиваем PRIME NETWORK о статусе покупки.</span></div></div>
      <footer class="pco-foot"></footer>`;
    this.paint(html, 'order');
    const foot = this.dialog!.querySelector('.pco-foot') as HTMLElement;
    this.setFoot(foot, this.orderIssue ? `<button type="button" class="btn pco-main" data-pco="recheck">Проверить ещё раз</button><button type="button" class="btn ghost pco-back" data-pco="back">Вернуться в магазин</button>` : `<button type="button" class="btn ghost pco-back" data-pco="back">Вернуться в магазин</button>`);
  }

  private renderOrder(ov: OrderView): void {
    const html = `${this.headFor(orderStatus(ov))}
      <div class="pco-body">
        ${orderBodyHTML(this.g, ov)}
        ${DEV_PREVIEW ? devPanelHTML(this.dev) : ''}
      </div>
      <footer class="pco-foot"></footer>`;
    this.paint(html, ov.phase === 'done' && !ov.issue ? 'done' : 'order');
    const foot = this.dialog!.querySelector('.pco-foot') as HTMLElement;
    if (this.busy) return this.setFoot(foot, `<button type="button" class="btn pco-main" data-pco="noop" disabled aria-disabled="true">Подождите…</button>`);
    this.setFoot(
      foot,
      orderFoot(ov)
        .map((b) => (b.href ? `<a class="btn ${b.cls}" data-pco="${b.act}" href="${esc(b.href)}">${esc(b.label)}</a>` : `<button type="button" class="btn ${b.cls}" data-pco="${b.act}" ${b.extra ?? ''}>${esc(b.label)}</button>`))
        .join(''),
    );
  }

  /** Write the dialog's HTML (unchanged HTML is not rewritten), keeping focus and the body's scroll. */
  private paint(html: string, block: string): void {
    if (html === this.lastHTML && this.dialog!.childElementCount) return;
    this.lastHTML = html;
    const keep = (document.activeElement as HTMLElement | null)?.dataset?.pco ?? (document.activeElement as HTMLElement | null)?.dataset?.dev ?? null;
    const scroll = (this.dialog!.querySelector('.pco-body') as HTMLElement | null)?.scrollTop ?? 0;
    this.root!.dataset.block = block;
    this.dialog!.innerHTML = html;
    const body = this.dialog!.querySelector('.pco-body') as HTMLElement | null;
    if (body && scroll) body.scrollTop = scroll;
    if (keep) (this.dialog!.querySelector(`[data-pco="${keep}"],[data-dev="${keep}"]`) as HTMLElement | null)?.focus({ preventScroll: true });
  }

  /** The payment mode: the server's answer for this account, else the catalog's (public config). */
  private payEnv(): PayEnv | null {
    return this.server?.env ?? this.g.shop.payEnv();
  }

  /** Robokassa's test mode (a staging server, the demonstration): said first and plainly. */
  private testBand(): string {
    if (DEV_PREVIEW || !isTestPay(this.payEnv())) return '';
    return `<div class="pco-testband" role="note"><b>${TEST_PAY_BAND}</b><span>${this.payEnv() === 'demo' ? 'Демонстрация оплаты для проверки магазина: тестовый режим Robokassa. Предмет выдаётся для демонстрации и не является покупкой.' : 'Тестовый сервер: тестовый режим Robokassa. Предмет выдаётся только здесь и не является покупкой.'}</span></div>`;
  }

  private headHTML(v: CheckoutView): string {
    const test = isTestPay(this.payEnv());
    const demo = this.payEnv() === 'demo';
    const status = this.checking
      ? { tone: 'wait', text: 'Проверяем PRIME ID…' }
      : DEV_PREVIEW
        ? { tone: 'test', text: 'Тестовый предпросмотр' }
        : test
          ? { tone: 'test', text: (demo ? 'Демо-оплата' : 'Тестовый платёж') + (v.canPay ? ' · готово' : '') }
          : v.canPay
            ? { tone: 'ok', text: 'Готово к оплате' }
            : v.block === 'price_pending' || v.block === 'sales_closed' || v.block === 'offer_missing' || v.block === 'payments_unavailable'
              ? { tone: 'soon', text: 'Продажи не открыты' }
              : { tone: 'live', text: 'Оформление покупки' };
    return this.headFor(status);
  }

  private headFor(status: { tone: string; text: string }): string {
    return `<header class="pco-head">
        <div class="pco-brand">
          <span class="pco-gem">${ICON.diamond}</span>
          <div class="pco-brand-text"><h2 class="pco-title" id="pco-title">PRIME <b>CHECKOUT</b></h2><div class="pco-sub">Official PRIME NETWORK purchase</div></div>
        </div>
        <button class="pco-x" type="button" data-pco="close" aria-label="Закрыть оформление">${ICON.close}</button>
        <div class="pco-status" data-tone="${status.tone}"><i></i>${esc(status.text)}</div>
      </header>`;
  }

  private itemHTML(v: CheckoutView, it: ShopItemDef): string {
    const who = it.skin ? FIGHTERS[SKINS[it.skin].fighter] : it.fighter ? FIGHTERS[it.fighter] : null;
    const kind = it.skin ? '3D-скин' : it.cosmetic ? it.kind : 'Сезонный боец';
    return `<article class="pco-item rar-${it.rarity}">
        <div class="pco-art">${shopArt(this.g, it)}</div>
        <div class="pco-info">
          <div class="pco-tags"><span class="si-rar">${RARITY[it.rarity]}</span><span class="pco-kind">${esc(kind)}</span></div>
          <h3 class="pco-name">${nameHTML(it.name)}</h3>
          ${who && it.skin ? `<div class="pco-who">Облик для бойца ${esc(who.name)} «${esc(who.nickname)}»</div>` : ''}
          <p class="pco-gets">${esc(this.getsText(it))}</p>
          ${
            v.block === 'seasonal_only'
              ? `<div class="pco-price"><span>Открытие</span><b>${esc(this.g.shop.state(it).price)}</b><small>не за рубли</small></div>`
              : v.block === 'owned'
                ? `<div class="pco-price"><span>Статус</span><b>${esc(this.g.shop.state(it).price)}</b></div>`
                : this.priceHTML(v, it)
          }
        </div>
      </article>`;
  }

  /**
   * The price: the official one; in Robokassa's test mode also what the test payment asks («деньги не списываются»)
   * — the item's real price is never replaced by a test amount without saying so.
   */
  private priceHTML(v: CheckoutView, it: ShopItemDef): string {
    if (DEV_PREVIEW || !isTestPay(this.payEnv()) || v.priceRub === null) {
      return `<div class="pco-price"><span>Итого</span><b>${esc(v.priceText)}</b>${v.priceRub !== null ? `<small>${DEV_PREVIEW ? 'тестовая цена' : 'RUB'}</small>` : ''}</div>`;
    }
    const list = this.server?.listKop ? (this.server.listKop[it.sku] ?? null) : this.g.shop.priceKop(it.sku);
    const charge = rubToKop(v.priceRub) ?? 0;
    return `<div class="pco-price"><span>Цена товара</span><b>${list === null ? 'Цена уточняется' : esc(formatKop(list))}</b><small>RUB</small></div>
      <div class="pco-price pco-testpay"><span>${list === charge ? 'Тестовая оплата' : 'Сумма тестовой оплаты'}</span><b>${esc(formatKop(charge))}</b><small>деньги не списываются</small></div>`;
  }

  /** What the player will have — no promise of an instant delivery. */
  private getsText(it: ShopItemDef): string {
    if (it.skin) return 'Новый облик бойца в вашем PRIME ID. Только внешний вид: характеристики, оружие и карты не меняются.';
    if (it.cosmetic) return `Предмет «${COSMETICS[it.cosmetic].name}» в «Моей коллекции» — надевается, когда захотите. Только внешний вид.`;
    return 'Сезонный боец Люсьен в вашем составе — с тростью VAMPIRE CANE BLASTER и фирменной картой BAT BITE.';
  }

  private info(v: CheckoutView): Info | null {
    const acc = v.account;
    switch (v.block) {
      case 'unavailable':
        return { tone: 'lock', title: 'Товар сейчас недоступен', text: 'Этот предмет нельзя оформить. Вернитесь в каталог PRIME SHOP.' };
      case 'owned':
        return { tone: 'ok', title: 'Уже в вашей коллекции', text: v.item?.fighter && !v.item.skin ? 'Люсьен уже в вашем составе — повторная покупка не нужна.' : 'Этот предмет уже ваш — повторная покупка не нужна.' };
      case 'seasonal_only':
        return v.item && this.g.shop.state(v.item).status === 'upcoming'
          ? { tone: 'lock', title: 'Откроется в сезонном событии', text: 'Люсьен открывается за PUMPKIN TOKENS во время Halloween Premiere. За рубли он сейчас не продаётся.' }
          : { tone: 'lock', title: 'Только за PUMPKIN TOKENS', text: 'Во время Halloween Premiere Люсьен открывается только за сезонные жетоны в разделе события. За рубли он сейчас не продаётся.' };
      case 'price_pending':
        return { tone: 'wait', title: 'Продажи пока не открыты', text: 'Цена этого предмета ещё не утверждена, купить его сейчас нельзя. Примерить можно бесплатно.' };
      case 'sales_closed':
        return { tone: 'wait', title: 'Покупки сейчас недоступны', text: 'Новые покупки в PRIME SHOP сейчас не принимаются. Уже оформленные заказы сохраняются и подтверждаются. Примерить предмет можно бесплатно.' };
      case 'offer_missing':
        return { tone: 'wait', title: 'Условия продажи готовятся', text: 'Публичная оферта PRIME SHOP ещё не опубликована. Без неё оформить покупку нельзя.' };
      case 'no_network':
        return { tone: 'lock', title: 'PRIME ID недоступен', text: 'В этой версии игры нет PRIME NETWORK, а покупки оформляются только с PRIME ID.' };
      case 'connecting':
        return { tone: 'wait', title: 'Подключение к PRIME NETWORK…', text: 'Проверяем ваш PRIME ID. Это займёт несколько секунд.' };
      case 'offline':
        return { tone: 'warn', title: 'Нет связи с PRIME NETWORK', text: 'Проверьте интернет и попробуйте ещё раз. Без подключения оформить покупку нельзя.' };
      case 'guest':
        return { tone: 'lock', title: 'Для покупок понадобится PRIME ID', text: 'Покупки привязываются к аккаунту, чтобы предметы оставались с вами после повторного входа — на этом или другом устройстве.' };
      case 'session_expired':
        return { tone: 'warn', title: 'Сессия PRIME ID истекла', text: 'Войдите снова — после входа вы вернётесь к этому товару.' };
      case 'unverified':
        return { tone: 'warn', title: 'Подтвердите email, чтобы продолжить', text: acc.email ? `Откройте ссылку из письма, отправленного на ${acc.email}, и нажмите «Я подтвердил». Нет письма — проверьте «Спам».` : 'Откройте ссылку из письма и нажмите «Я подтвердил». Нет письма — проверьте «Спам».' };
      case 'legal_required':
        return { tone: 'warn', title: 'Примите документы PRIME ID', text: 'Перед покупками нужно принять актуальные документы PRIME ID — это займёт минуту.' };
      case 'adult_only':
        return { tone: 'lock', title: 'Покупки — только с 18 лет', text: 'По условиям оферты покупки в PRIME SHOP доступны только совершеннолетним владельцам PRIME ID. Примерить предмет можно бесплатно.' };
      case 'session_elsewhere':
        return { tone: 'warn', title: 'PRIME ID открыт на другом устройстве', text: 'Продолжите игру здесь, чтобы оформить покупку на этом устройстве.' };
      case 'account_changed':
        return { tone: 'warn', title: 'Вы вошли в другой PRIME ID', text: 'Оформление было начато в другом аккаунте. Проверьте товар и начните заново.' };
      case 'payments_unavailable':
        return { tone: 'wait', title: 'Оплата не подключена', text: 'Сейчас оплата не принимается. Никаких списаний не происходит.' };
      case 'server_unavailable':
        return { tone: 'warn', title: 'PRIME NETWORK временно недоступен', text: 'Сервер не ответил или ответил ошибкой. Попробуйте через минуту — если заказ уже создан, он сохранится и откроется снова.' };
      case 'rate_limited':
        return { tone: 'warn', title: 'Слишком много попыток', text: 'Подождите немного и попробуйте снова. Уже созданный заказ сохраняется.' };
      default:
        return null;
    }
  }

  private stateHTML(v: CheckoutView): string {
    const i = this.info(v);
    if (!i) return `<div class="pco-state" id="pco-state" data-tone="ok"><b>Всё готово</b><span>Проверьте товар, цену и условия, затем перейдите к оплате.</span></div>`;
    if (v.block === 'guest') {
      return `<div class="pco-state pco-gate" id="pco-state" data-tone="lock">
          <span class="pco-gate-ico">${ICON.id}</span>
          <b class="pco-gate-kicker">Подключись к PRIME NETWORK</b>
          <b>${esc(i.title)}</b>
          <span>${esc(i.text)}</span>
        </div>`;
    }
    return `<div class="pco-state" id="pco-state" data-tone="${i.tone}" role="status"><b>${esc(i.title)}</b><span>${esc(i.text)}</span></div>`;
  }

  private accountHTML(v: CheckoutView): string {
    const a = v.account;
    let line: string;
    if (a.state === 'none') line = '<span>PRIME ID недоступен в этой версии игры</span>';
    else if (a.state === 'guest') line = '<span>Вы играете как гость — покупки привязываются к PRIME ID</span>';
    else if (a.state === 'connecting' && !a.id) line = '<span>Подключение к PRIME NETWORK…</span>';
    else if (a.state === 'offline' && !a.id) line = '<span>PRIME NETWORK сейчас не отвечает</span>';
    else line = `<b>${esc(a.nickname || 'PRIME ID')}</b>${a.email ? `<span>${esc(a.email)}</span>` : ''}`;
    // signing in is always within reach (the main button offers it only when it is the next step)
    const signIn =
      (a.state === 'guest' || a.state === 'expired') && v.block !== 'guest' && v.block !== 'session_expired'
        ? `<button type="button" class="pco-acc-btn" data-pco="login">${a.state === 'guest' ? 'Войти' : 'Войти снова'}</button>`
        : '';
    return `<section class="pco-acc" aria-label="PRIME ID">
        <span class="pco-acc-ico">${ICON.id}</span>
        <div class="pco-acc-text"><small>Покупка для PRIME ID</small>${line}</div>${signIn}
      </section>`;
  }

  private offerHTML(v: CheckoutView): string {
    const o = v.offer;
    if (!o) {
      return `<section class="pco-offer"><span class="pco-offer-ico">${ICON.doc}</span><div><b>Условия покупки</b><span>Публичная оферта PRIME SHOP будет опубликована до начала продаж.</span></div></section>`;
    }
    // the terms read in place (a sheet over this window; the page stays a plain link for a browser without scripts)
    const link = (label: string) => (o.url ? `<a href="${esc(o.url)}" target="_blank" rel="noopener" data-pco="doc">${label}</a>` : `<button type="button" class="pco-doc" data-pco="doc">${label}</button>`);
    const head = `<span class="pco-offer-ico">${ICON.doc}</span><div><b>${link(esc(o.title))}</b><span>Редакция ${o.revision} · действует с ${esc(offerDate(o))}${o.url ? '' : ' · тест, документа нет'}</span></div>`;
    // the consent box: for a signed-in account that can buy, never ticked in advance
    const canTick = v.block === null || v.block === 'payments_unavailable';
    // 1.8.8 stage 4: a staging server (and the demonstration) in Robokassa's test mode offers stand-in TEST
    // terms, not an offer
    const test = isTestPay(this.server?.env) && !DEV_PREVIEW;
    const demo = this.server?.env === 'demo';
    let consent = '';
    if (v.consent === 'accepted') consent = `<p class="pco-accepted">${UI_ICONS.check.replace('<svg', '<svg width="13" height="13"')} ${test ? 'Тестовые условия уже приняты.' : 'Вы уже приняли эту редакцию условий.'}</p>`;
    else if (canTick) {
      consent = `${v.consent === 'renew' ? '<p class="pco-renew">Условия обновились — подтвердите новую редакцию.</p>' : ''}
        <label class="pco-check">
          <input type="checkbox" data-pco="consent" ${this.ticked ? 'checked' : ''}>
          <span class="pco-box" aria-hidden="true">${UI_ICONS.check}</span>
          <span class="pco-check-text">${test ? (demo ? 'Я понимаю, что это демонстрационная оплата Robokassa: настоящие деньги не списываются, предмет выдаётся для демонстрации и не является покупкой' : 'Я понимаю, что это тестовая оплата Robokassa: деньги не списываются, предмет выдаётся только на тестовом сервере') : `Я ознакомился и согласен с условиями ${link('публичной оферты PRIME SHOP')}`}</span>
        </label>`;
    }
    return `<section class="pco-offer has-doc"><div class="pco-offer-row">${head}</div>${consent}</section>`;
  }

  private noteText(v: CheckoutView): string {
    const open = v.block === null ? this.server?.orders.find((o) => o.sku === this.sku) : undefined;
    if (open) return `Заказ №${open.inv} уже создан и ждёт оплаты: кнопка откроет его же, а не новый заказ.`;
    if (v.block === 'owned') return 'Предметы, полученные в PRIME ID, хранятся в аккаунте и доступны после повторного входа.';
    if (v.block === 'seasonal_only') return 'Сезонный способ открытия и цена в жетонах не меняются.';
    if (isTestPay(this.server?.env) && (v.canPay || v.block === null)) return 'Тестовый режим Robokassa: настоящие деньги не списываются. Предмет станет доступен после подтверждения тестовой оплаты сервером PRIME NETWORK — возврат на сайт сам по себе ничего не выдаёт.';
    if (v.canPay || v.block === null) return `Это настоящая покупка: будет списано ${v.priceRub !== null ? v.priceText : 'указанная сумма'}. Оплата — на защищённой странице Robokassa: данные карты PRIME NETWORK не получает. Предмет станет доступен в вашем PRIME ID после подтверждения оплаты сервером.`;
    return 'Сейчас оплата не подключена — никаких списаний не происходит. Предмет станет доступен только после подтверждения оплаты сервером PRIME NETWORK.';
  }

  /** The footer: one clear main action, a way back. Re-drawn alone when the consent box changes. */
  private renderFoot(): void {
    // following an order: its own footer (renderOrder)
    if (this.orderInv !== null) return this.render();
    const foot = this.dialog?.querySelector('.pco-foot') as HTMLElement | null;
    if (!foot || !this.sku) return;
    const v = this.view();
    const btn = (act: string, label: string, cls: string, extra = '') => `<button type="button" class="btn ${cls}" data-pco="${act}" ${extra}>${label}</button>`;
    const back = btn('back', 'Назад к товару', 'ghost pco-back');
    let main = '';
    let more = '';
    switch (v.block) {
      case 'guest':
        main = btn('login', 'Войти в PRIME ID', 'pco-main');
        more = btn('register', 'Создать аккаунт', 'pco-alt') + btn('later', 'Пока не сейчас', 'ghost pco-back');
        return this.setFoot(foot, main + more);
      case 'session_expired':
        main = btn('login', 'Войти снова', 'pco-main');
        break;
      case 'unverified':
        main = btn('verified', 'Я подтвердил', 'pco-main');
        more = btn('resend', 'Отправить письмо ещё раз', 'pco-alt');
        break;
      case 'legal_required':
        main = btn('terms', 'Открыть документы', 'pco-main');
        break;
      case 'offline':
      case 'server_unavailable':
      case 'rate_limited':
        main = btn('retry', 'Повторить', 'pco-main');
        break;
      case 'session_elsewhere':
        main = btn('here', 'Продолжить здесь', 'pco-main');
        break;
      case 'account_changed':
        main = btn('restart', 'Начать заново', 'pco-main');
        break;
      case 'owned':
        main = v.item?.fighter && !v.item.skin ? btn('roster', 'Мои бойцы', 'pco-main', `data-f="${v.item.fighter}"`) : btn('collection', 'Моя коллекция', 'pco-main');
        break;
      case 'seasonal_only':
        main = btn('events', 'К событию', 'pco-main');
        break;
      case null: {
        const ready = v.canPay && !this.busy;
        // an open order of this item on the server: «Перейти к оплате» opens the SAME order (no second payment)
        const open = this.server?.orders.some((o) => o.sku === this.sku) ?? false;
        const label = this.busy ? 'Подождите…' : `${open ? 'Продолжить оплату' : 'Перейти к оплате'}${v.priceRub !== null ? ` · ${esc(v.priceText)}` : ''}`;
        main = btn('pay', label, 'pco-main', ready ? '' : 'disabled aria-disabled="true"');
        if (!v.canPay && (v.consent === 'needed' || v.consent === 'renew')) more = `<p class="pco-hint">${isTestPay(this.server?.env) && !DEV_PREVIEW ? 'Отметьте, что понимаете условия тестовой оплаты, чтобы продолжить.' : 'Отметьте согласие с условиями оферты, чтобы продолжить.'}</p>`;
        break;
      }
      default: {
        // nothing the player can do here yet: an honest, inactive main button
        const label = v.block === 'payments_unavailable' ? 'Оплата не подключена' : v.block === 'connecting' ? 'Подключение…' : 'Покупка недоступна';
        main = btn('pay', label, 'pco-main', 'disabled aria-disabled="true"');
      }
    }
    this.setFoot(foot, main + more + back);
  }

  private footEl: HTMLElement | null = null;
  private footHTML = '';

  /** Write the footer only when it changed, keeping the focused button focused. */
  private setFoot(foot: HTMLElement, html: string): void {
    if (foot === this.footEl && html === this.footHTML) return;
    const keep = foot.contains(document.activeElement) ? ((document.activeElement as HTMLElement).dataset.pco ?? null) : null;
    foot.innerHTML = html;
    this.footEl = foot;
    this.footHTML = html;
    if (keep) (foot.querySelector(`[data-pco="${keep}"]`) as HTMLElement | null)?.focus({ preventScroll: true });
  }
}
