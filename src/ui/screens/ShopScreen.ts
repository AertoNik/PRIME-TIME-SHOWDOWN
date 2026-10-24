import { Color } from 'three';
import { FIGHTERS } from '../../config/fighters';
import { LOOKS } from '../../config/looks';
import { currentOffer, offerDate } from '../../config/offer.config';
import { SHOP_CATEGORIES, SHOP_ITEMS, SKINS, shopItem, type ShopCategory, type ShopItemDef, type ShopSku } from '../../config/shop.config';
import { Rng } from '../../core/math';
import type { Game } from '../../game/Game';
import { clearPending, loadPending, resumeDecision, sessionStore } from '../../meta/Checkout';
import { clearReturn, isTestPay, loadReturn } from '../../meta/Payments';
import type { ShopItemState } from '../../meta/Shop';
import { PrimeCheckout, checkoutAccount } from '../checkoutUI';
import { DASH_FX, VICTORY_FX, dashBurst, dashColor, victoryCelebration } from '../../render/cosmeticFx';
import { cardHTML, el, esc, setScreenHTML } from '../dom';
import { sellerCardHTML } from '../sellerLine';
import { hex, nameHTML, shopArt } from '../shopArt';
import { UI_ICONS } from '../icons';
import type { Screen } from '../UI';

const RARITY: Record<ShopItemDef['rarity'], string> = { rare: 'Редкий', epic: 'Эпический', legendary: 'Легендарный' };
/** Fitting-room zoom steps (1 = the whole fighter in the stage). */
const ZOOMS = [1, 1.4, 1.85];

const S = (body: string, vb = '0 0 64 64') => `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;

const TOOL_ICONS = {
  minus: S('<path d="M14 32 H50" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>'),
  plus: S('<path d="M14 32 H50 M32 14 V50" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>'),
  reset: S('<path d="M50 30 A18 18 0 1 1 40 15" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/><path d="M36 6 L46 16 L34 22" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>'),
  play: S('<path d="M20 12 L52 32 L20 52 Z" fill="currentColor"/>'),
  star: S('<path d="M32 6 L39 23 L57 24 L43 36 L48 54 L32 44 L16 54 L21 36 L7 24 L25 23 Z" fill="currentColor"/>'),
  rotate: S('<path d="M10 34 C10 22 22 16 32 16 C42 16 54 22 54 34" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><path d="M4 28 L10 36 L17 29 M60 28 L54 36 L47 29" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><ellipse cx="32" cy="46" rx="14" ry="4" fill="currentColor" opacity=".5"/>'),
};

/**
 * Alpha 1.8.8 — PRIME SHOP: the shop of PRIME NETWORK. A catalog of the seven items and an item page
 * with the fitting room: the real 3D fighter in the menu studio (no second scene) for skins and the
 * dash / victory effects, real HUD and card markup for the frame and the card style.
 *
 * Trying on never writes anything: the shop shows a preview look on the pedestal and plays effects,
 * the save and the real equipment stay as they are (leaving the page shows the fighter as worn).
 * Buying is not open: the button explains why (Shop.requestPurchase) and grants nothing.
 */
export class ShopScreen implements Screen {
  readonly el: HTMLElement;
  private g: Game;
  private cat: 'all' | ShopCategory = 'all';
  /** The item page that is open (null: the catalog). */
  private sku: ShopSku | null = null;
  /** Fitting room: show the standard look instead of the skin. */
  private base = false;
  /** Effect previews: play the standard effect for comparison. */
  private compare = false;
  private zoomI = 0;
  private catScroll = 0;
  private backTo: 'menu' | 'collection' = 'menu';
  /** Bumped whenever the page changes: late preview effects check it before playing. */
  private alive = 0;
  private dashDir = 1;
  private autoTimer: ReturnType<typeof setTimeout> | null = null;
  private drag: { id: number; x: number; y: number; on: boolean } | null = null;
  private rng = new Rng(17);
  /** 1.8.8 stage 3 — PRIME CHECKOUT, the purchase window (one, reused). */
  private checkout: PrimeCheckout;
  /** The player left the window for PRIME ID: when its dialogs close, bring them back to the item. */
  private awaiting = false;

  constructor(g: Game) {
    this.g = g;
    this.checkout = new PrimeCheckout(g);
    this.checkout.onAwaitSignIn = () => (this.awaiting = true);
    this.el = el('div', 'shop');
    this.el.addEventListener('click', (e) => this.onClick(e));
    // the fitting room turns the fighter with a sideways drag; a vertical swipe is left to the page
    this.el.addEventListener('pointerdown', (e) => {
      if (!(e.target as HTMLElement).closest('[data-drag]') || (e.target as HTMLElement).closest('button')) return;
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, on: false };
    });
    window.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x;
      if (!d.on) {
        if (Math.abs(dx) < 6 || Math.abs(dx) < Math.abs(e.clientY - d.y)) return;
        d.on = true;
        this.g.showcase.setDragging(true);
        this.el.querySelector('.fit-hint')?.classList.add('gone');
      }
      d.x = e.clientX;
      this.g.showcase.drag(dx);
    });
    const end = (e: PointerEvent) => {
      if (this.drag?.id !== e.pointerId) return;
      this.endDrag();
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    this.el.addEventListener(
      'wheel',
      (e) => {
        if (!(e.target as HTMLElement).closest('[data-drag]')) return;
        this.zoom(e.deltaY < 0 ? 1 : -1);
      },
      { passive: true },
    );
  }

  onShow(params?: unknown): void {
    const p = params as { sku?: ShopSku; from?: 'menu' | 'collection'; resume?: boolean; payReturn?: boolean } | undefined;
    this.backTo = p?.from === 'collection' ? 'collection' : 'menu';
    this.cat = 'all';
    this.catScroll = 0;
    const sku = p?.sku && SHOP_ITEMS.some((i) => i.sku === p.sku) ? p.sku : null;
    if (sku) this.openItem(sku);
    else this.showCatalog(false);
    // 1.8.8 stage 3: back after PRIME ID (the sign-in reloaded the page) — the note says to which item
    if (p?.resume) this.resumeFromNote();
    // 1.8.8 stage 4: back from Robokassa — the order's screen (what the server says, nothing assumed)
    if (p?.payReturn) this.resumePayment();
    // the paid items of this PRIME ID, as the server has them now (another device may have bought)
    this.g.account?.refreshRights(true);
  }

  onHide(): void {
    this.checkout.close(false);
    this.awaiting = false;
    this.leaveItem();
    this.sku = null;
  }

  /** PRIME ID's dialogs closed after the player left the purchase window for them. */
  update(): void {
    if (!this.awaiting || this.g.ui.modalOpen) return;
    this.awaiting = false;
    if (!this.resumePayment()) this.resumeFromNote();
  }

  /**
   * 1.8.8 stage 4: the note of an order this tab left to pay (or followed before signing in): the item and
   * the order's screen again. Used once; false when there is none.
   */
  private resumePayment(): boolean {
    const store = sessionStore();
    const n = loadReturn(store);
    if (!n) return false;
    clearReturn(store);
    if (n.sku && this.sku !== n.sku) this.openItem(n.sku);
    this.checkout.openOrder(n.inv, { sku: n.sku, result: n.result, from: this.backTo, opener: this.el.querySelector('[data-act="buy"]') as HTMLElement | null });
    return true;
  }

  /**
   * The «back to the item» note: signed in → the item and the purchase window again (everything is
   * checked anew); another account → the item, started afresh; still not signed in → nothing (the
   * player closed PRIME ID: they are on the item already). The note is used once.
   */
  private resumeFromNote(): void {
    const store = sessionStore();
    const p = loadPending(store);
    if (!p) return;
    clearPending(store);
    const d = resumeDecision(p, checkoutAccount(this.g));
    if (d === 'wait') return;
    this.backTo = p.from;
    if (this.sku !== p.sku) this.openItem(p.sku);
    if (d === 'reset') {
      this.g.ui.toast('Вы вошли в другой PRIME ID — проверьте товар и начните заново');
      return;
    }
    this.checkout.open(p.sku, { from: p.from, startedFor: p.account, opener: this.el.querySelector('[data-act="buy"]') as HTMLElement | null });
  }

  // ------------------------------------------------------------ navigation
  private onClick(e: Event): void {
    const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!t) return;
    const g = this.g;
    const act = t.dataset.act!;
    const sku = t.dataset.sku as ShopSku | undefined;
    switch (act) {
      case 'back':
        g.audio.ui('click');
        if (this.sku) this.showCatalog(true);
        else g.goto(this.backTo);
        break;
      case 'cat':
        g.audio.ui('swipe');
        this.cat = t.dataset.cat as 'all' | ShopCategory;
        this.catScroll = 0;
        this.renderCatalog(false);
        break;
      case 'open':
      case 'try':
        if (!sku) return;
        g.audio.ui('confirm');
        this.openItem(sku);
        break;
      case 'var':
        g.audio.ui('swipe');
        this.base = t.dataset.v === 'base';
        this.renderItem();
        this.showPreview();
        break;
      case 'cmp':
        g.audio.ui('swipe');
        this.compare = t.dataset.v === 'std';
        this.renderItem();
        this.play();
        break;
      case 'play':
        this.play();
        break;
      case 'pose':
        g.audio.ui('click');
        g.showcase.cheer();
        break;
      case 'zoom-in':
        this.zoom(1);
        break;
      case 'zoom-out':
        this.zoom(-1);
        break;
      case 'reset':
        g.audio.ui('click');
        this.zoomI = 0;
        this.base = false;
        this.compare = false;
        g.showcase.resetYaw();
        this.renderItem();
        this.showPreview();
        break;
      case 'buy':
        this.buy(t);
        break;
      case 'wear':
      case 'unwear':
        this.wear(act === 'wear');
        break;
      case 'events':
        g.audio.ui('click');
        g.goto('events');
        break;
      case 'roster':
        g.audio.ui('click');
        g.goto('roster', t.dataset.f);
        break;
      case 'collection':
        g.audio.ui('click');
        g.goto('collection');
        break;
      case 'profile':
        g.audio.ui('click');
        g.goto('profile');
        break;
    }
  }

  private showCatalog(restore: boolean): void {
    this.leaveItem();
    this.sku = null;
    this.g.showcase.hide();
    this.renderCatalog(false);
    if (restore) {
      const sc = this.el.querySelector('.shop-scroll') as HTMLElement | null;
      if (sc) sc.scrollTop = this.catScroll;
    }
  }

  private openItem(sku: ShopSku): void {
    const sc = this.el.querySelector('.shop-scroll') as HTMLElement | null;
    if (sc && !this.sku) this.catScroll = sc.scrollTop;
    this.leaveItem();
    this.sku = sku;
    this.base = false;
    this.compare = false;
    this.zoomI = 0;
    this.renderItem(false);
    this.showPreview();
    // the effect plays once by itself (not with reduced motion — the button is there)
    const it = shopItem(sku);
    if ((it.preview === 'dash' || it.preview === 'confetti') && !reducedMotion()) {
      const token = this.alive;
      this.autoTimer = setTimeout(() => this.alive === token && this.play(), 650);
    }
  }

  /** Leaving an item page: stop previews; the pedestal goes back to the fighter as really worn. */
  private leaveItem(): void {
    this.alive++;
    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.autoTimer = null;
    this.endDrag();
    this.g.showcaseZoom = 1;
    if (this.sku) {
      const sel = this.g.save.data.selected;
      this.g.showcase.show(this.g.fighterLook(sel), FIGHTERS[sel].theme.accent);
    }
  }

  private endDrag(): void {
    if (this.drag?.on) this.g.showcase.setDragging(false);
    this.drag = null;
  }

  // ------------------------------------------------------------ catalog
  private renderCatalog(keep = true): void {
    const g = this.g;
    const states = g.shop.states();
    const signedIn = !!g.account?.api?.sessionRecord;
    const cats = SHOP_CATEGORIES.filter((c) => this.cat === 'all' || this.cat === c.id);
    const sections = cats
      .map((c) => {
        const list = states.filter((s) => s.item.category === c.id);
        const size = c.id === 'skins' ? 'hero' : c.id === 'fighters' ? 'wide' : 'tile';
        return `<section class="shop-sec sec-${c.id}">
          <div class="shop-sec-title"><span>${esc(c.title)}</span><i></i><b>${list.length}</b></div>
          <div class="shop-grid g-${size}">${list.map((s) => this.itemCard(s, size)).join('')}</div>
        </section>`;
      })
      .join('');
    // 1.8.8 stage 3: the offer in force (offer.config.ts) — readable here without buying anything
    const doc = currentOffer();
    const offer = doc
      ? `<a class="sf-offer" href="${esc(doc.url)}" target="_blank" rel="noopener">${esc(doc.title)} · редакция ${doc.revision} от ${esc(offerDate(doc))}</a>`
      : `<div class="sf-offer">Публичная оферта PRIME SHOP будет опубликована здесь до начала продаж.</div>`;
    this.el.classList.remove('at-item', 'dom-preview');
    setScreenHTML(
      this.el,
      `${this.head('<div class="sh-logo"><span>PRIME</span><b>SHOP</b></div><div class="sh-sub">Витрина звёзд эфира PRIME NETWORK</div>', true)}
      <div class="fill scroll shop-scroll">
        <div class="shop-strip"><span>${TOOL_ICONS.rotate}Примерка бесплатно</span><span>Покупки — с PRIME ID</span><span>${esc(g.shop.priceNote())}</span></div>
        <div class="seg-control shop-cats" role="tablist">
          ${[{ id: 'all', title: 'Всё' }, ...SHOP_CATEGORIES.map((c) => ({ id: c.id, title: c.id === 'effects' ? 'Эффекты' : c.title }))]
            .map((c) => `<button class="${this.cat === c.id ? 'on' : ''}" role="tab" aria-selected="${this.cat === c.id}" data-act="cat" data-cat="${c.id}">${esc(c.title)}</button>`)
            .join('')}
        </div>
        ${sections}
        <section class="shop-foot">
          <button class="sf-row" data-act="collection">
            <span class="sf-ico">${UI_ICONS.archive}</span>
            <span class="sf-text"><b>Моя коллекция</b><small>Полученные облики и эффекты надеваются и снимаются здесь</small></span>
            <span class="ee-go">${UI_ICONS.next}</span>
          </button>
          <div class="sf-row sf-pid">
            <span class="sf-ico sf-id">ID</span>
            <span class="sf-text"><b>PRIME ID</b><small>${signedIn ? 'Будущие покупки будут храниться в вашем аккаунте.' : 'Смотреть и примерять можно без входа. Для покупок понадобится PRIME ID.'}</small></span>
            ${signedIn ? '' : '<button class="btn ghost sf-btn" data-act="profile">PRIME ID</button>'}
          </div>
          ${sellerCardHTML()}
          ${offer}
        </section>
      </div>`,
      keep,
    );
  }

  private head(title: string, catalog: boolean): string {
    return `<div class="screen-head shop-head" style="padding-right:62px">
        <button class="icon-btn" data-act="back" aria-label="${catalog ? 'Назад' : 'К каталогу'}">${UI_ICONS.back}</button>
        <div class="sh-title">${title}</div>
        ${catalog ? '<span class="sh-net"><i></i>PRIME NETWORK</span>' : ''}
      </div>`;
  }

  private itemCard(st: ShopItemState, size: 'hero' | 'tile' | 'wide'): string {
    const it = st.item;
    const tryLabel = it.category === 'fighters' ? 'Смотреть в 3D' : 'Примерить';
    return `<article class="si si-${size} rar-${it.rarity} st-${st.status}">
        <div class="si-art" data-act="open" data-sku="${it.sku}">${shopArt(this.g, it)}<span class="si-rar">${RARITY[it.rarity]}</span></div>
        <div class="si-body">
          <div class="si-kind">${esc(it.kind.split(' · ')[0])}</div>
          <div class="si-name">${nameHTML(it.name)}</div>
          <div class="si-desc">${esc(it.desc)}</div>
          <div class="si-foot"><span class="si-chip">${esc(st.chip)}</span><span class="si-price">${esc(st.price)}</span></div>
          <div class="si-actions">
            <button class="btn si-try" data-act="try" data-sku="${it.sku}">${TOOL_ICONS.rotate}${tryLabel}</button>
            <button class="btn ghost si-more" data-act="open" data-sku="${it.sku}" aria-label="${esc(it.name)}: подробнее">Подробнее</button>
          </div>
        </div>
      </article>`;
  }

  // ------------------------------------------------------------ item page + fitting room
  private renderItem(keep = true): void {
    const g = this.g;
    const it = shopItem(this.sku!);
    const st = g.shop.state(it);
    const p = it.preview;
    const three = p === 'model' || p === 'dash' || p === 'confetti' || p === 'fighter';
    let stage: string;
    if (three) {
      const variants = it.skin
        ? `<div class="seg-control fit-var"><button class="${this.base ? 'on' : ''}" data-act="var" data-v="base">Стандарт</button><button class="${this.base ? '' : 'on'}" data-act="var" data-v="skin">${esc(SKINS[it.skin].name)}</button></div>`
        : p === 'dash' || p === 'confetti'
          ? `<div class="seg-control fit-var"><button class="${this.compare ? 'on' : ''}" data-act="cmp" data-v="std">Стандарт</button><button class="${this.compare ? '' : 'on'}" data-act="cmp" data-v="item">${esc(it.name)}</button></div>`
          : '';
      const action =
        p === 'dash'
          ? `<button class="fit-btn wide" data-act="play">${TOOL_ICONS.play}Рывок</button>`
          : p === 'confetti'
            ? `<button class="fit-btn wide" data-act="play">${TOOL_ICONS.play}Победа</button>`
            : `<button class="fit-btn wide" data-act="pose">${TOOL_ICONS.star}Поза</button>`;
      stage = `<div class="fit-stage">
          <div class="fit-gap" data-drag>
            <span class="fit-badge">${it.category === 'fighters' ? '3D-просмотр' : 'Примерка'} · ничего не покупается</span>
            <span class="fit-hint">${TOOL_ICONS.rotate}Потяните в сторону, чтобы повернуть</span>
          </div>
          <div class="fit-tools">
            ${variants}
            <div class="fit-btns">
              ${action}
              <button class="fit-btn" data-act="zoom-out" aria-label="Отдалить" ${this.zoomI === 0 ? 'disabled' : ''}>${TOOL_ICONS.minus}</button>
              <button class="fit-btn" data-act="zoom-in" aria-label="Приблизить" ${this.zoomI === ZOOMS.length - 1 ? 'disabled' : ''}>${TOOL_ICONS.plus}</button>
              <button class="fit-btn" data-act="reset" aria-label="Вернуть вид">${TOOL_ICONS.reset}</button>
            </div>
          </div>
        </div>`;
    } else stage = `<div class="fit-stage fit-dom"><span class="fit-badge">Предпросмотр · ничего не покупается</span>${p === 'frame' ? this.frameDemo() : this.cardsDemo()}</div>`;
    const who = it.skin ? FIGHTERS[SKINS[it.skin].fighter] : it.fighter ? FIGHTERS[it.fighter] : null;
    this.el.classList.add('at-item');
    this.el.classList.toggle('dom-preview', !three);
    setScreenHTML(
      this.el,
      `${this.head(`<div class="sh-kicker">PRIME SHOP · ${it.category === 'fighters' ? 'Персонаж' : 'Примерка'}</div><div class="sh-name">${nameHTML(it.name)}</div>`, false)}
      <div class="fit rar-${it.rarity}">
        ${stage}
        <div class="fit-info scroll">
          <div class="fi-top"><span class="si-rar">${RARITY[it.rarity]}</span><span class="fi-kind">${esc(it.kind)}</span></div>
          ${who ? `<div class="fi-who">${esc(who.name)} «${esc(who.nickname)}» · ${esc(who.style)}</div>` : ''}
          <p class="fi-desc">${esc(it.desc)}</p>
          <ul class="fi-list">${it.highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>
          ${it.skin ? '<p class="fi-fair">Только внешний вид: здоровье, урон, скорость, оружие, карты и анимации бойца не меняются.</p>' : it.cosmetic ? '<p class="fi-fair">Только внешний вид: на бой, карты и награды не влияет.</p>' : ''}
          <div class="fi-status"><span class="si-chip st-${st.status}">${esc(st.chip)}</span><b class="fi-price">${esc(st.price)}</b></div>
          ${!st.owned && g.shop.testPayLine(it.sku) ? `<div class="fi-testpay">${esc(g.shop.testPayLine(it.sku)!)}</div>` : ''}
          <div class="fi-actions">${this.actions(st)}</div>
          <p class="fi-note">${esc(st.note)}</p>
        </div>
      </div>`,
      keep,
    );
  }

  private actions(st: ShopItemState): string {
    const it = st.item;
    switch (st.status) {
      case 'equipped':
        return `<button class="btn ghost wide" data-act="unwear">Снять</button>`;
      case 'owned':
        return `<button class="btn teal wide" data-act="wear">Надеть</button>`;
      case 'seasonal':
        return `<button class="btn wide" data-act="events">К событию</button>`;
      case 'received':
        return `<button class="btn teal wide" data-act="roster" data-f="${it.fighter}">Мои бойцы</button>`;
      case 'upcoming':
        return '';
      default:
        // 1.8.8 stage 3: opens PRIME CHECKOUT — while sales are closed it explains why (nothing is charged or granted)
        return st.status === 'on_sale'
          ? `<button class="btn wide" data-act="buy">${isTestPay(this.g.shop.payEnv()) ? 'Тестовая покупка' : 'Оформить покупку'} · ${esc(st.price)}</button>`
          : `<button class="btn shop-buy wide" data-act="buy">Пока не продаётся · подробнее</button>`;
    }
  }

  /** PRIME BROADCAST: the standard broadcast and the premium one side by side (same HUD markup). */
  private frameDemo(): string {
    const screen = (prime: boolean) => `<div class="fd-screen ${prime ? 'prime' : ''}">
        <div class="fd-frame"><i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i></div>
        <div class="fd-top"><span class="fd-hp"><i style="width:72%"></i></span><span class="fd-timer"><b class="fd-live">LIVE</b>1:15</span><span class="fd-hp r"><i style="width:54%"></i></span></div>
        <div class="fd-floor"></div>
        <div class="fd-hand"><i></i><i></i><i></i></div>
      </div>`;
    return `<div class="frame-demo">
        <figure>${screen(false)}<figcaption>Стандарт</figcaption></figure>
        <figure>${screen(true)}<figcaption>PRIME BROADCAST</figcaption></figure>
      </div>`;
  }

  /** VHS CARD FRAME: the selected fighter's real cards — as they are now and in VHS, with hand states. */
  private cardsDemo(): string {
    const s = this.g.save.data;
    const deck = s.fighters[s.selected].deck.slice(0, 4);
    const row = () =>
      deck
        .map((c, i) => {
          const state = i === 1 ? 'combo-ready' : i === 3 ? 'disabled' : '';
          // the battle hand's own markup (no role tag), with its real states
          return `<div class="cd-slot">${cardHTML(c, `hand-card ${state}`, false)}</div>`;
        })
        .join('');
    return `<div class="cards-demo">
        <div class="cd-label">Сейчас</div>
        <div class="cd-row">${row()}</div>
        <div class="cd-label vhs">VHS CARD FRAME</div>
        <div class="cd-row vhs-set">${row()}</div>
        <div class="cd-legend"><span>2-я карта — готово комбо</span><span>4-я — не хватает энергии</span></div>
      </div>`;
  }

  /** Put the preview on the pedestal (or hide it for the HUD / card previews). Writes nothing. */
  private showPreview(): void {
    const g = this.g;
    const it = shopItem(this.sku!);
    const sel = g.save.data.selected;
    let look: string | null = null;
    let accent: string = FIGHTERS[sel].theme.accent;
    if (it.skin) {
      const sk = SKINS[it.skin];
      look = this.base ? FIGHTERS[sk.fighter].look : sk.look;
      accent = this.base ? FIGHTERS[sk.fighter].theme.accent : hex(LOOKS[sk.look].glow);
    } else if (it.fighter) {
      look = FIGHTERS[it.fighter].look;
      accent = FIGHTERS[it.fighter].theme.accent;
    } else if (it.preview === 'dash' || it.preview === 'confetti') look = g.fighterLook(sel);
    if (!look) {
      g.showcase.hide();
      return;
    }
    g.showcase.show(look, accent);
    g.showcaseZoom = ZOOMS[this.zoomI];
    g.frameShowcase();
  }

  private zoom(d: number): void {
    if (!this.sku || !this.el.querySelector('.fit-gap')) return;
    const z = Math.max(0, Math.min(ZOOMS.length - 1, this.zoomI + d));
    if (z === this.zoomI) return;
    this.g.audio.ui('click');
    this.zoomI = z;
    this.g.showcaseZoom = ZOOMS[z];
    this.g.frameShowcase();
    const out = this.el.querySelector('[data-act="zoom-out"]') as HTMLButtonElement | null;
    const inn = this.el.querySelector('[data-act="zoom-in"]') as HTMLButtonElement | null;
    if (out) out.disabled = z === 0;
    if (inn) inn.disabled = z === ZOOMS.length - 1;
  }

  /** Play the dash / victory preview (the standard effect when comparing). VFX pools only. */
  private play(): void {
    if (!this.sku) return;
    const g = this.g;
    const it = shopItem(this.sku);
    const id = it.cosmetic ?? '';
    if (it.preview === 'dash') {
      const fx = this.compare ? null : (DASH_FX[id] ?? null);
      const own = new Color(LOOKS[g.showcase.look]?.glow ?? 0x22f0e0);
      const color = dashColor(fx) ?? own;
      this.dashDir = -this.dashDir;
      const from = -0.95 * this.dashDir;
      const to = 0.95 * this.dashDir;
      g.audio.ui('swipe');
      g.showcase.demoDash(from, to);
      dashBurst(g.vfx, this.rng, fx, color, from, 0.3, to, 0.3);
    } else if (it.preview === 'confetti') {
      const fx = this.compare ? null : (VICTORY_FX[id] ?? null);
      const token = this.alive;
      g.audio.ui('confirm');
      g.showcase.cheer();
      setTimeout(() => {
        if (this.alive !== token) return;
        victoryCelebration(g.vfx, fx, 0, 0, g.battleView.style.confetti, () => this.alive === token);
      }, 380);
    }
  }

  // ------------------------------------------------------------ wear / buy
  private wear(on: boolean): void {
    const g = this.g;
    const it = shopItem(this.sku!);
    let ok = false;
    if (it.skin) ok = g.shop.setSkin(SKINS[it.skin].fighter, on ? it.skin : null);
    else if (it.cosmetic) ok = g.collection.setEquipped(it.cosmetic, on);
    if (!ok) {
      g.ui.toast('Сначала предмет должен появиться в вашей коллекции');
      return;
    }
    g.audio.ui(on ? 'confirm' : 'click');
    g.applyCosmetics();
    g.ui.toast(`${it.name}: ${on ? 'надето' : 'снято'}`);
    this.renderItem();
  }

  /** 1.8.8 stage 3: the purchase button opens PRIME CHECKOUT — it explains what can happen and what cannot yet. */
  private buy(opener: HTMLElement): void {
    if (!this.sku) return;
    this.g.audio.ui('confirm');
    this.checkout.open(this.sku, { opener, from: this.backTo });
  }
}

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
