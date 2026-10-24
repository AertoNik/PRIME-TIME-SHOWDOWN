import type { OfferRevision } from '../config/offer.config';
import type { ShopItemDef } from '../config/shop.config';
import type { CheckoutAccount, CheckoutInput } from '../meta/Checkout';
import type { OrderPhase, OrderStatus } from '../meta/Payments';
import type { OrderView } from './checkoutOrder';
import { esc } from './dom';

// Alpha 1.8.8 (stage 3) — DEVELOPMENT ONLY: a test scenario for the PRIME CHECKOUT window (address bar
// `?checkoutpreview` in `npm run dev`). It feeds made-up data into the same window — a test price, a
// test offer revision, account states, a «payments ready» switch — so every state can be looked at.
// Everything it shows is marked «ТЕСТ»; it sends nothing anywhere, records no consent, creates no order
// and grants nothing. 1.8.8 stage 4: the «Заказ» row shows the order screens (checking, confirmed, not
// finished, delayed, under review, closed, no connection) with a made-up order — no server is asked. It is separate from `?shopgrant` (which lends shop items for the wardrobe), and
// production builds drop it: every use sits behind import.meta.env.DEV.

export interface DevScenario {
  account: 'live' | 'guest' | 'unverified' | 'expired' | 'terms' | 'ready' | 'other' | 'offline';
  sales: 'live' | 'open';
  offer: 'live' | 'test' | 'changed';
  payments: 'live' | 'test';
  order: 'none' | 'checking' | 'slow' | 'done' | 'fail' | 'unpaid' | 'review' | 'closed' | 'offline' | 'leaving';
}

export const DEV_SCENARIO_DEFAULT: DevScenario = { account: 'live', sales: 'open', offer: 'test', payments: 'live', order: 'none' };

/** A made-up price for the test (not a decision about real prices). */
export const TEST_PRICE_RUB = 149;

const TEST_HASH = '0'.repeat(64);
/** A test revision: no page exists for it, so the window shows no link. */
function testOffer(revision: number): OfferRevision {
  return { revision, title: 'Тестовая редакция оферты', url: '', effectiveFrom: new Date().toISOString().slice(0, 10), sha256: TEST_HASH };
}

const TEST_ACCOUNT: Omit<CheckoutAccount, 'state'> = { id: 'test-account-a', nickname: 'TEST PRODUCER', email: 'te•••@prime.test' };

/** The window's input with the test choices laid over the live data. */
export function applyDevScenario(i: CheckoutInput, s: DevScenario): CheckoutInput {
  const out: CheckoutInput = { ...i };
  if (s.sales === 'open' && out.state && !out.state.owned && out.state.status !== 'seasonal' && out.state.status !== 'upcoming') {
    out.priceRub = TEST_PRICE_RUB;
    out.salesOpen = true;
  }
  if (s.offer === 'test') {
    out.offer = testOffer(1);
    out.acceptedRevision = 0;
  } else if (s.offer === 'changed') {
    out.offer = testOffer(2);
    out.acceptedRevision = 1;
  }
  if (s.account !== 'live') {
    if (s.account === 'other') {
      out.account = { ...TEST_ACCOUNT, state: 'ready', id: 'test-account-b', nickname: 'OTHER PRODUCER' };
      out.startedFor = TEST_ACCOUNT.id;
    } else out.account = s.account === 'guest' ? { state: 'guest', id: null, nickname: '', email: '' } : { ...TEST_ACCOUNT, state: s.account };
  }
  if (s.payments === 'test') out.paymentsReady = true;
  return out;
}

/** The order screens with a made-up test order (nothing is asked, paid or granted). */
export function devOrderView(item: ShopItemDef, s: DevScenario, inv: number): OrderView {
  const map: Record<Exclude<DevScenario['order'], 'none'>, [OrderStatus, OrderPhase]> = {
    checking: ['pending_payment', 'checking'],
    slow: ['pending_payment', 'checking'],
    done: ['fulfilled', 'done'],
    fail: ['pending_payment', 'unpaid'],
    unpaid: ['pending_payment', 'unpaid'],
    review: ['requires_review', 'review'],
    closed: ['expired', 'closed'],
    offline: ['pending_payment', 'checking'],
    leaving: ['pending_payment', 'unpaid'],
  };
  const [status, phase] = map[s.order === 'none' ? 'checking' : s.order];
  return {
    item,
    order: { inv, sku: item.sku, title: item.name, amountKop: TEST_PRICE_RUB * 100, currency: 'RUB', status, env: 'test', created: '', expiresAt: 0, paidAt: 0, fulfilledAt: 0 },
    inv,
    phase,
    issue: s.order === 'offline' ? 'offline' : null,
    slow: s.order === 'slow',
    leaving: s.order === 'leaving',
    failReturn: s.order === 'fail',
    nickname: TEST_ACCOUNT.nickname,
  };
}

const ROWS: { key: keyof DevScenario; label: string; opts: [string, string][] }[] = [
  {
    key: 'account',
    label: 'PRIME ID',
    opts: [
      ['live', 'как есть'],
      ['guest', 'гость'],
      ['unverified', 'email'],
      ['expired', 'сессия'],
      ['terms', 'документы'],
      ['ready', 'вошёл'],
      ['other', 'другой'],
      ['offline', 'нет сети'],
    ],
  },
  {
    key: 'sales',
    label: 'Продажи',
    opts: [
      ['live', 'как в игре'],
      ['open', `открыты · ${TEST_PRICE_RUB} ₽`],
    ],
  },
  {
    key: 'offer',
    label: 'Оферта',
    opts: [
      ['live', 'как в игре'],
      ['test', 'редакция 1'],
      ['changed', 'изменилась'],
    ],
  },
  {
    key: 'payments',
    label: 'Оплата',
    opts: [
      ['live', 'не подключена'],
      ['test', 'готова (тест)'],
    ],
  },
  {
    key: 'order',
    label: 'Заказ',
    opts: [
      ['none', 'нет'],
      ['leaving', 'переход'],
      ['checking', 'проверка'],
      ['slow', 'задержка'],
      ['done', 'подтверждён'],
      ['fail', 'не завершён'],
      ['unpaid', 'ждёт оплаты'],
      ['review', 'проверка вручную'],
      ['closed', 'закрыт'],
      ['offline', 'нет сети'],
    ],
  },
];

export function devPanelHTML(s: DevScenario): string {
  return `<details class="pco-dev" open>
      <summary>Тестовый предпросмотр · dev</summary>
      <p>Данные ниже вымышлены: ничего не отправляется, согласие не записывается, заказ не создаётся.</p>
      ${ROWS.map(
        (r) => `<div class="pco-dev-row"><span>${esc(r.label)}</span><div>${r.opts
          .map(([v, l]) => `<button type="button" class="${s[r.key] === v ? 'on' : ''}" data-dev="${r.key}:${v}" aria-pressed="${s[r.key] === v}">${esc(l)}</button>`)
          .join('')}</div></div>`,
      ).join('')}
    </details>`;
}

/** A tap in the panel: the new scenario (null: not a panel button). */
export function devScenarioTap(s: DevScenario, t: HTMLElement): DevScenario | null {
  const v = t.dataset.dev;
  if (!v) return null;
  const [k, val] = v.split(':') as [keyof DevScenario, string];
  return { ...s, [k]: val } as DevScenario;
}
