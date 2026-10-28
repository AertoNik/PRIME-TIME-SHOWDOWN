import { COSMETICS } from '../config/cosmetics.config';
import { formatKop, type ShopItemDef } from '../config/shop.config';
import type { Game } from '../game/Game';
import { SUPPORT_EMAIL, TEST_PAY_BAND, isTestPay, type OrderPhase, type ServerOrder } from '../meta/Payments';
import { esc } from './dom';
import { nameHTML, shopArt } from './shopArt';

// Alpha 1.8.8 (stage 4) — PRIME CHECKOUT, the order screens: the way to Robokassa, «checking the payment»,
// «not finished», «under review», refunds — and the premium «ПОКУПКА ПОДТВЕРЖДЕНА» once (and only once) the
// server's order is fulfilled AND the item is in the server's list of this PRIME ID's rights. Pure HTML from
// what the server said (PrimeCheckout asks it); nothing here pays, grants or saves.

/**
 * Why the order cannot be shown or paid right now (besides its own state). 1.8.9: each cause has its own words —
 * «нет связи» only when PRIME NETWORK cannot be reached at all:
 *   offline       no connection to PRIME NETWORK          timeout   PRIME NETWORK did not answer in time
 *   server        PRIME NETWORK answered 5xx              rate      too many requests (429)
 *   refused       PRIME NETWORK refused (another 4xx)     paused    new payments are paused on the server
 *   leave_failed  Robokassa's page did not open (this page was still here after the form was sent)
 *   missing       the order belongs to another PRIME ID   signin    sign in to see it
 */
export type OrderIssue = 'offline' | 'timeout' | 'server' | 'rate' | 'refused' | 'paused' | 'missing' | 'signin' | 'leave_failed' | null;

/** The server codes that mean «no new payment here now» (the order itself is kept and still confirmed). */
const PAUSED = ['sales_closed', 'payments_unavailable', 'receipt_required_for_live'];

/** An API failure (PrimeApiError kind and code) → the issue the order screen shows. */
export function issueOfError(kind: string, code: string): Exclude<OrderIssue, null | 'leave_failed'> {
  if (PAUSED.includes(code)) return 'paused';
  if (kind === 'network') return code === 'timeout' ? 'timeout' : 'offline';
  if (kind === 'rate' || code === 'too_many_orders') return 'rate';
  if (kind === 'server') return 'server';
  if (kind === 'unauthorized') return 'signin';
  if (kind === 'notfound') return 'missing';
  return 'refused';
}

/** Why PRIME NETWORK refused another try (the issue «refused»), in the player's words. */
const REFUSED: Record<string, string> = {
  legal_required: 'Сначала примите актуальные документы PRIME ID — это займёт минуту.',
  not_verified: 'Сначала подтвердите email вашего PRIME ID.',
  adult_only: 'По условиям оферты покупки в PRIME SHOP доступны только с 18 лет.',
  price_pending: 'Цена этого предмета сейчас уточняется.',
  unknown_item: 'Этот предмет сейчас недоступен.',
  seasonal_only: 'Этот предмет сейчас открывается только за жетоны события.',
  session_superseded: 'PRIME ID открыт на другом устройстве — продолжите там или вернитесь сюда.',
};

/** Robokassa's page was opened in ANOTHER tab (the first one waits and checks when the player comes back). */
export type OrderElsewhere = boolean;

export interface OrderView {
  item: ShopItemDef;
  /** The order as the server last showed it (null: not answered yet). */
  order: ServerOrder | null;
  inv: number;
  phase: OrderPhase | null;
  issue: OrderIssue;
  /** Asked enough times and still waiting: «загляните позже», never endless requests. */
  slow: boolean;
  /** On the way to Robokassa's page right now. */
  leaving: boolean;
  /** Came back through Robokassa's FailURL. */
  failReturn: boolean;
  /** The payment page was opened in a new tab from here. */
  elsewhere?: OrderElsewhere;
  /** 1.8.9: the signed page is here (a new tab opens right inside the tap); false after a reload. */
  canNewTab?: boolean;
  /** 1.8.9: the page was fetched again for a new tab and waits for the player's tap. */
  prepared?: boolean;
  /** 1.8.9: tries left to open Robokassa's page for this order in this tab (0: only checking the order). */
  triesLeft?: number;
  /** 1.8.9: the server's code behind «refused» / «paused». */
  issueCode?: string;
  /** Who it is for (PRIME ID nickname). */
  nickname: string;
}

interface Banner {
  tone: 'wait' | 'warn' | 'lock' | 'ok';
  title: string;
  text: string;
  busy?: boolean;
}

const ICON_RECEIPT = `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M16 6 H48 V58 L42 53 L36 58 L32 54 L28 58 L22 53 L16 58 Z" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linejoin="round"/><path d="M24 22 H40 M24 31 H40 M24 40 H34" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>`;

const isTest = (v: OrderView) => isTestPay(v.order?.env);

/** The chip under the title. */
export function orderStatus(v: OrderView): { tone: string; text: string } {
  const t = (s: string) => (isTest(v) ? `Тест · ${s}` : s);
  if (v.leaving) return { tone: 'wait', text: t('Переход к оплате…') };
  if (v.elsewhere && v.phase !== 'done' && !v.issue) return { tone: 'wait', text: t('Оплата в новой вкладке') };
  if (v.prepared && !v.issue) return { tone: 'wait', text: t('Страница оплаты готова') };
  switch (v.issue) {
    case 'leave_failed':
      return { tone: 'warn', text: t('Страница оплаты не открылась') };
    case 'offline':
      return { tone: 'warn', text: t('Нет связи') };
    case 'timeout':
      return { tone: 'warn', text: t('Сервер не ответил') };
    case 'server':
      return { tone: 'warn', text: t('Сервер временно недоступен') };
    case 'rate':
      return { tone: 'warn', text: t('Слишком много попыток') };
    case 'paused':
      return { tone: 'warn', text: t('Оплата приостановлена') };
    case 'refused':
      return { tone: 'warn', text: t('Запрос отклонён') };
    case 'missing':
    case 'signin':
      return { tone: 'live', text: 'Заказ PRIME SHOP' };
  }
  switch (v.phase) {
    case 'done':
      return { tone: 'ok', text: t('Покупка подтверждена') };
    case 'checking':
    case 'delivering':
      return v.slow ? { tone: 'soon', text: t('Ждём подтверждение') } : { tone: 'wait', text: t('Проверяем оплату…') };
    case null:
      return { tone: 'wait', text: t('Проверяем оплату…') };
    case 'unpaid':
      return v.failReturn ? { tone: 'warn', text: t('Оплата не завершена') } : { tone: 'soon', text: t('Ожидает оплаты') };
    case 'closed':
      return { tone: 'warn', text: t('Заказ закрыт') };
    case 'review':
      return { tone: 'warn', text: t('Покупка на проверке') };
    case 'refund':
      return { tone: 'live', text: t('Возврат') };
  }
}

/** The order's main message (title and text). */
export function orderBanner(v: OrderView): Banner {
  const n = `№${v.inv}`;
  if (v.leaving) return { tone: 'wait', busy: true, title: 'Переходим на страницу оплаты Robokassa…', text: 'Оплата проходит на защищённой странице Robokassa — данные карты PRIME NETWORK не получает и не хранит.' };
  if (v.elsewhere && !v.issue && (v.phase === null || v.phase === 'unpaid' || v.phase === 'checking')) {
    return { tone: 'wait', title: 'Оплата открыта в новой вкладке', text: `Оплатите заказ ${n} на странице Robokassa в новой вкладке. Когда вернётесь сюда, статус обновится сам — или нажмите «Проверить статус».` };
  }
  if (v.prepared && !v.issue) {
    return { tone: 'wait', title: 'Страница оплаты готова', text: `Нажмите «Открыть оплату в новой вкладке» — страница Robokassa для заказа ${n} откроется рядом, а здесь статус обновится, когда вы вернётесь.` };
  }
  switch (v.issue) {
    case 'leave_failed':
      return (v.triesLeft ?? 1) > 0
        ? { tone: 'warn', title: 'Страница оплаты не открылась', text: `Страница Robokassa не загрузилась. Так бывает, когда она недоступна из вашей сети — например, через VPN или фильтр. Заказ ${n} сохранён, новая попытка использует его же. Если вы уже оплатили, проверьте статус.` }
        : { tone: 'warn', title: 'Страница оплаты не открывается', text: `Мы остановили повторные попытки, чтобы не запускать оплату по кругу. Заказ ${n} сохранён. Попробуйте позже — из другой сети без VPN или в другом браузере. Если вы уже оплатили, проверьте статус.` };
    case 'offline':
      return { tone: 'warn', title: 'Нет связи с PRIME NETWORK', text: 'Покупка не потеряется: когда связь вернётся, проверьте статус ещё раз — или загляните в PRIME SHOP позже.' };
    case 'timeout':
      return { tone: 'warn', title: 'PRIME NETWORK не ответил вовремя', text: `Ответ не пришёл за 10 секунд. Заказ ${n} хранится на сервере — проверьте статус ещё раз через минуту.` };
    case 'server':
      return { tone: 'warn', title: 'PRIME NETWORK временно недоступен', text: `Сервер ответил ошибкой. Заказ ${n} хранится на сервере и не потеряется — проверьте статус чуть позже.` };
    case 'rate':
      return { tone: 'warn', title: 'Слишком много попыток', text: `Подождите минуту и проверьте статус заказа ${n} ещё раз.` };
    case 'paused':
      return { tone: 'warn', title: 'Новые оплаты временно приостановлены', text: `Заказ ${n} сохранён. Если вы уже оплатили его, оплата будет подтверждена и предмет выдан — проверьте статус. Продолжить оплату можно, когда PRIME SHOP снова откроется.` };
    case 'refused':
      return { tone: 'warn', title: 'Повторить оплату сейчас нельзя', text: `${REFUSED[v.issueCode ?? ''] ?? 'PRIME NETWORK отклонил запрос.'} Заказ ${n} сохранён.` };
    case 'missing':
      return { tone: 'lock', title: 'Заказ не найден в этом PRIME ID', text: `Заказ ${n} оформлен в другом аккаунте. Войдите в тот PRIME ID, чтобы увидеть покупку.` };
    case 'signin':
      return { tone: 'lock', title: 'Войдите в PRIME ID', text: 'Покупки хранятся в аккаунте: войдите в PRIME ID, с которого оформляли заказ, — и статус покажется здесь.' };
  }
  switch (v.phase) {
    case null:
      return { tone: 'wait', busy: true, title: 'Проверяем заказ…', text: 'Спрашиваем PRIME NETWORK о статусе покупки.' };
    case 'checking':
      return v.slow
        ? { tone: 'wait', title: 'Подтверждение задерживается', text: 'Если вы оплатили заказ, предмет появится в «Моей коллекции» сам, как только PRIME NETWORK получит подтверждение от Robokassa, — даже если закрыть игру. Загляните позже или проверьте ещё раз.' }
        : { tone: 'wait', busy: true, title: 'Проверяем подтверждение оплаты…', text: 'Robokassa сообщает PRIME NETWORK о платеже — обычно это несколько секунд. Окно можно закрыть: покупка не потеряется.' };
    case 'delivering':
      return v.slow
        ? { tone: 'wait', title: 'Выдача задерживается', text: 'Оплата зафиксирована сервером, предмет будет выдан автоматически. Если он не появится в течение часа — напишите нам.' }
        : { tone: 'wait', busy: true, title: 'Оплата подтверждена — выдаём предмет…', text: 'Ещё мгновение: предмет добавляется в ваш PRIME ID.' };
    case 'unpaid':
      if ((v.triesLeft ?? 1) <= 0) {
        return { tone: 'warn', title: 'Оплата не завершена', text: `Мы остановили повторные попытки оплаты заказа ${n}, чтобы не запускать её по кругу. Заказ сохранён — попробуйте через 10 минут, лучше из другой сети без VPN или в другом браузере. Если вы уже оплатили, проверьте статус.` };
      }
      return v.failReturn
        ? { tone: 'warn', title: 'Оплата не завершена', text: `Платёж на странице Robokassa не был завершён — предмет не выдан. Заказ ${n} сохранён: новая попытка использует его же.` }
        : { tone: 'wait', title: 'Заказ ожидает оплаты', text: `Заказ ${n} создан, оплата по нему ещё не поступила. Продолжите оплату или проверьте статус, если уже оплатили.` };
    case 'closed':
      return v.order?.status === 'failed'
        ? { tone: 'lock', title: 'Платёж не прошёл', text: `Robokassa сообщила, что оплата заказа ${n} не прошла. Предмет не выдан.` }
        : { tone: 'lock', title: 'Заказ закрыт', text: `Заказ ${n} не был оплачен вовремя и закрыт. Предмет не выдан — оформите покупку заново.` };
    case 'review':
      return { tone: 'warn', title: 'Покупка на проверке', text: `С заказом ${n} нужно разобраться вручную — например, если он оплачен дважды. Мы ответим на почту вашего PRIME ID; можно написать и нам.` };
    case 'refund':
      return v.order?.status === 'refunded'
        ? { tone: 'lock', title: 'Возврат выполнен', text: `Деньги по заказу ${n} возвращены, предмет из этого заказа отозван.` }
        : { tone: 'wait', title: 'Оформляется возврат', text: `Возврат по заказу ${n} в обработке. Деньги вернутся тем же способом, которым была оплата; предмет из этого заказа будет отозван после возврата.` };
    case 'done':
      return { tone: 'ok', title: 'Покупка подтверждена', text: '' };
  }
}

/** «Деньги списались, а предмет не появился?» — the official contact, with the order number. */
function supportHTML(v: OrderView): string {
  const show = v.slow || v.phase === 'review' || v.phase === 'refund' || (v.phase === 'unpaid' && v.failReturn) || v.issue === 'missing' || v.issue === 'leave_failed' || v.issue === 'paused';
  if (!show) return '';
  const href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`PRIME SHOP: заказ ${v.inv}`)}`;
  return `<p class="pco-note pco-support">Деньги списались, а предмет не появился? Напишите на <a href="${href}">${SUPPORT_EMAIL}</a> и укажите номер заказа <b>${v.inv}</b> — мы выдадим предмет или вернём оплату.</p>`;
}

function whatYouGot(it: ShopItemDef): string {
  if (it.skin) return 'Новый облик теперь в вашем PRIME ID. Выберите его в «Моей коллекции» → «Облики бойцов».';
  if (it.cosmetic) return `Предмет «${COSMETICS[it.cosmetic].name}» теперь в вашем PRIME ID — наденьте его в «Моей коллекции», когда захотите.`;
  return 'Люсьен «Ночная звезда» теперь в вашем составе — с тростью VAMPIRE CANE BLASTER и фирменной картой BAT BITE.';
}

function metaLine(v: OrderView): string {
  const parts = [`Заказ №${v.inv}`];
  if (v.order) parts.push(formatKop(v.order.amountKop));
  if (v.nickname) parts.push(v.nickname);
  return parts.map(esc).join(' · ');
}

/** The premium «purchase confirmed» moment — shown only for phase «done». */
function winHTML(g: Game, v: OrderView): string {
  const it = v.item;
  return `<section class="pco-win rar-${it.rarity}" id="pco-state" role="status" aria-live="polite">
      <div class="pco-win-rays" aria-hidden="true"></div>
      <div class="pco-win-sparks" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
      <div class="pco-win-kicker">${isTest(v) ? 'Тестовая покупка подтверждена' : 'Покупка подтверждена'}</div>
      <h3 class="pco-win-title">Добро пожаловать<b>в PRIME COLLECTION</b></h3>
      <div class="pco-win-stage"><div class="pco-win-halo" aria-hidden="true"></div><div class="pco-win-art">${shopArt(g, it)}</div></div>
      <div class="pco-win-name">${nameHTML(it.name)}</div>
      <p class="pco-win-text">${esc(whatYouGot(it))}</p>
      <div class="pco-win-meta">${metaLine(v)}</div>
      ${isTest(v) ? `<div class="pco-win-test">${TEST_PAY_BAND}</div>` : ''}
    </section>`;
}

/** Everything between the head and the footer for an order. */
export function orderBodyHTML(g: Game, v: OrderView): string {
  if (v.phase === 'done' && !v.issue && !v.leaving) return winHTML(g, v);
  const it = v.item;
  const b = orderBanner(v);
  const amount = v.order ? formatKop(v.order.amountKop) : '';
  return `<article class="pco-item pco-item-compact rar-${it.rarity}">
        <div class="pco-art">${shopArt(g, it)}</div>
        <div class="pco-info">
          <h3 class="pco-name">${nameHTML(it.name)}</h3>
          ${amount ? `<div class="pco-price"><span>${isTest(v) ? 'Сумма тестовой оплаты' : 'Сумма заказа'}</span><b>${esc(amount)}</b>${isTest(v) ? '<small>деньги не списываются</small>' : '<small>RUB</small>'}</div>` : ''}
        </div>
      </article>
      <div class="pco-state${b.busy ? ' is-busy' : ''}" id="pco-state" data-tone="${b.tone}" role="status" aria-live="polite"><b>${b.busy ? '<i class="pco-spin" aria-hidden="true"></i>' : ''}${esc(b.title)}</b>${b.text ? `<span>${esc(b.text)}</span>` : ''}</div>
      <section class="pco-acc pco-order" aria-label="Заказ">
        <span class="pco-acc-ico">${ICON_RECEIPT}</span>
        <div class="pco-acc-text"><small>Заказ PRIME SHOP</small><b>№${v.inv}</b><span>${esc([amount, v.nickname ? `PRIME ID ${v.nickname}` : ''].filter(Boolean).join(' · '))}</span></div>
      </section>
      ${supportHTML(v)}
      ${isTest(v) ? `<p class="pco-note">${v.order?.env === 'demo' ? 'Демонстрационная оплата в тестовом режиме Robokassa: настоящие деньги не списываются. Предмет выдан для демонстрации и действует, пока идёт демонстрационный режим.' : 'Тестовый режим Robokassa: настоящие деньги не списываются, предмет выдаётся только на тестовом сервере.'}</p>` : ''}`;
}

/** The footer's buttons for an order: [action, label, class, extra attributes]. */
export function orderFoot(v: OrderView): { act: string; label: string; cls: string; extra?: string; href?: string }[] {
  const back = { act: 'back', label: 'Вернуться в магазин', cls: 'ghost pco-back' };
  if (v.leaving) return [{ act: 'noop', label: 'Переход к оплате…', cls: 'pco-main', extra: 'disabled aria-disabled="true"' }];
  const left = (v.triesLeft ?? 1) > 0;
  // a new tab opens only from a page already here (inside the tap); otherwise it is fetched first («prepare»)
  const newTab = { act: v.canNewTab ? 'newtab' : 'prepare', label: v.canNewTab ? 'Открыть в новой вкладке' : 'Подготовить оплату в новой вкладке', cls: 'pco-alt' };
  if (v.prepared && !v.issue && left && (v.phase === null || v.phase === 'unpaid')) {
    return [{ act: 'newtab', label: 'Открыть оплату в новой вкладке', cls: 'pco-main' }, { act: 'recheck', label: 'Проверить статус', cls: 'pco-alt' }, back];
  }
  if (v.elsewhere && !v.issue && (v.phase === null || v.phase === 'unpaid' || v.phase === 'checking')) {
    return [{ act: 'recheck', label: 'Проверить статус', cls: 'pco-main' }, ...(left && v.canNewTab ? [{ act: 'newtab', label: 'Открыть оплату ещё раз', cls: 'pco-alt' }] : []), back];
  }
  switch (v.issue) {
    case 'leave_failed':
      return left
        ? [{ act: 'repay', label: 'Повторить оплату здесь', cls: 'pco-main' }, newTab, { act: 'recheck', label: 'Я оплатил — проверить статус', cls: 'ghost pco-back' }, back]
        : [{ act: 'recheck', label: 'Проверить статус', cls: 'pco-main' }, back];
    case 'offline':
    case 'timeout':
    case 'server':
    case 'rate':
    case 'paused':
    case 'refused':
      return [{ act: 'recheck', label: 'Проверить статус', cls: 'pco-main' }, back];
    case 'missing':
      return [{ act: 'back', label: 'Назад к товару', cls: 'pco-main' }];
    case 'signin':
      return [{ act: 'login', label: 'Войти в PRIME ID', cls: 'pco-main' }, back];
  }
  switch (v.phase) {
    case null:
    case 'checking':
    case 'delivering':
      return v.slow ? [{ act: 'recheck', label: 'Проверить ещё раз', cls: 'pco-main' }, back] : [{ act: 'noop', label: 'Проверяем…', cls: 'pco-main', extra: 'disabled aria-disabled="true"' }, back];
    case 'unpaid':
      return left
        ? [{ act: 'repay', label: v.failReturn ? 'Повторить оплату' : 'Продолжить оплату', cls: 'pco-main' }, { act: 'recheck', label: 'Проверить статус', cls: 'pco-alt' }, { act: 'back', label: 'Назад к товару', cls: 'ghost pco-back' }]
        : [{ act: 'recheck', label: 'Проверить статус', cls: 'pco-main' }, { act: 'back', label: 'Назад к товару', cls: 'ghost pco-back' }];
    case 'done':
      return v.item.fighter && !v.item.skin
        ? [{ act: 'roster', label: 'В мой состав', cls: 'pco-main', extra: `data-f="${v.item.fighter}"` }, { act: 'back', label: 'Назад в магазин', cls: 'ghost pco-back' }]
        : [{ act: 'collection', label: 'В мою коллекцию', cls: 'pco-main' }, { act: 'back', label: 'Назад в магазин', cls: 'ghost pco-back' }];
    case 'closed':
      return [{ act: 'anew', label: 'Оформить заново', cls: 'pco-main' }, { act: 'back', label: 'Назад к товару', cls: 'ghost pco-back' }];
    case 'review':
      return [{ act: 'support', label: 'Написать в поддержку', cls: 'pco-main', href: `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`PRIME SHOP: заказ ${v.inv}`)}` }, back];
    case 'refund':
      return [{ act: 'recheck', label: 'Проверить статус', cls: 'pco-alt' }, back];
  }
}
