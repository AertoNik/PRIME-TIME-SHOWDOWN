import { COSMETICS } from '../config/cosmetics.config';
import { FIGHTERS } from '../config/fighters';
import { plural } from '../config/events.config';
import { currentOffer } from '../config/offer.config';
import {
  SHOP_ITEMS,
  SHOP_SALES_OPEN,
  SKINS,
  SKU_OF_SKIN,
  approvedPriceRub,
  formatKop,
  isSkinId,
  rubToKop,
  shopItem,
  type ShopItemDef,
  type ShopSku,
  type SkinId,
} from '../config/shop.config';
import { CLIENT_PAYMENTS, buildCheckout, type CheckoutBlock } from './Checkout';
import type { FighterId } from '../config/types';
import type { Collection } from './Collection';
import { devGrant, ownsPaid, paidSource } from './entitlements';
import { isTestPay, type PayEnv } from './Payments';
import type { EventManager } from './EventManager';
import type { SaveSystem } from './SaveSystem';

// Alpha 1.8.8 — PRIME SHOP: what each item's card says (owned, worn, price, seasonal state) and the
// wardrobe of skins. Three things are kept apart on purpose:
//   preview    the fitting room shows anything to anyone and writes nothing (ShopScreen)
//   wearing    save.shop — the player's choice; it is only honoured for an owned item
//   owning     entitlements.ts — paid items only through a confirmed purchase (the server, stage 4)
// LUCIEN is not sold here: the shop reads his season from EventManager (one calendar).

export type ShopStatus =
  /** Owned and worn. */
  | 'equipped'
  /** Owned, not worn. */
  | 'owned'
  /** Not on sale yet (price not approved or sales not open). */
  | 'soon'
  /** On sale — only once SHOP_SALES_OPEN and a price exist (stage 4). */
  | 'on_sale'
  /** LUCIEN while Halloween Premiere runs: opened for PUMPKIN TOKENS only. */
  | 'seasonal'
  /** LUCIEN before his season. */
  | 'upcoming'
  /** LUCIEN after his season, not opened: a future paid way. */
  | 'after_season'
  /** LUCIEN opened (by any way). */
  | 'received';

/** One look of a fighter in the wardrobe (Shop.wardrobe). */
export interface WardrobeEntry {
  /** null: the fighter's standard look. */
  skin: SkinId | null;
  /** The look id FighterModel builds. */
  look: string;
  name: string;
  /** May be worn now: the standard look always, a skin only while owned. */
  available: boolean;
  worn: boolean;
  /** Where the right comes from (entitlements.paidSource): a purchase, a test-mode / demonstration right, a dev grant. */
  source: 'purchase' | 'test' | 'dev' | null;
}

export interface ShopItemState {
  item: ShopItemDef;
  status: ShopStatus;
  /** Short chip on the card («НАДЕТО», «ЦЕНА УТОЧНЯЕТСЯ», «ПОЛУЧЕН»…). */
  chip: string;
  /** The price line: roubles once approved, otherwise an honest status. */
  price: string;
  /** One more line of explanation (seasonal rules, how to wear it). */
  note: string;
  owned: boolean;
}

/**
 * 1.8.8 stage 4: what the PRIME NETWORK server says about selling (GET /api/prime/config, public): whether it
 * sells now (sales open AND payments configured), in which mode (live; test — a staging server; demo — the
 * official site's demonstration, both in Robokassa's test mode), the items' OFFICIAL prices and what a payment in
 * this mode asks (the same numbers PRIME CHECKOUT and the payment page use).
 */
export interface ShopServerInfo {
  selling: boolean;
  env: PayEnv;
  /** Official prices in kopecks (null: not approved). */
  pricesKop: Record<string, number | null>;
  /** What a payment asks in this mode, kopecks (null: not for sale here); live and demo: the official price. */
  chargeKop: Record<string, number | null>;
  /** The demonstration's last day (YYYY-MM-DD, Moscow time) — '' outside a demonstration. */
  demoUntil?: string;
}

/** Why a purchase did not start. Stage 4 adds the success case — and only the server can produce it. */
export interface PurchaseRefusal {
  ok: false;
  code: 'owned' | 'seasonal' | 'not_on_sale' | 'needs_prime_id' | 'checkout_unavailable';
  message: string;
}

export class Shop {
  private store: SaveSystem;
  private events: EventManager;
  private collection: Collection;
  /** The server's word on prices and selling (null: not known — no accounts in this build, or offline). */
  private server: ShopServerInfo | null = null;

  constructor(store: SaveSystem, events: EventManager, collection: Collection) {
    this.store = store;
    this.events = events;
    this.collection = collection;
  }

  // ------------------------------------------------------------ ownership
  owns(item: ShopItemDef): boolean {
    if (item.skin) return ownsPaid(item.sku);
    if (item.cosmetic) return this.collection.owns(item.cosmetic);
    if (item.fighter) return this.events.ownsFighter(item.fighter);
    return false;
  }

  ownsSkin(id: SkinId): boolean {
    return ownsPaid(SKU_OF_SKIN[id]);
  }

  isWorn(item: ShopItemDef): boolean {
    if (item.skin) return this.skinFor(SKINS[item.skin].fighter) === item.skin;
    if (item.cosmetic) return this.collection.equipped(this.slotOf(item)!) === item.cosmetic;
    return false;
  }

  private slotOf(item: ShopItemDef) {
    return item.cosmetic ? COSMETICS[item.cosmetic].slot : null;
  }

  /** 1.8.8 stage 4: the server's prices and selling flag (AccountRuntime, from /api/prime/config). */
  setServer(info: ShopServerInfo | null): void {
    this.server = info;
  }

  /** The server's payment mode (null: not known — no accounts in this build, or offline). */
  payEnv(): PayEnv | null {
    return this.server?.env ?? null;
  }

  /**
   * The item's OFFICIAL price in kopecks: the server's when known, otherwise the APPROVED price of this release —
   * null while it is only proposed (SHOP_PRICE_STATUS, item by item). Never a test amount.
   */
  priceKop(sku: ShopSku): number | null {
    if (this.server) {
      const k = this.server.pricesKop[sku];
      return typeof k === 'number' && k > 0 ? k : null;
    }
    return rubToKop(approvedPriceRub(sku));
  }

  /** What a payment for the item asks on this server now, in kopecks (null: not for sale here, or not known). */
  chargeKop(sku: ShopSku): number | null {
    const k = this.server?.chargeKop[sku];
    return typeof k === 'number' && k > 0 ? k : null;
  }

  /**
   * Is the item buyable right now: the server sells (sales open + payments configured) and asks an amount for it.
   * A staging server and the demonstration sell Robokassa TEST payments by themselves; a live sale also needs
   * this release to open sales.
   */
  selling(sku: ShopSku): boolean {
    const s = this.server;
    if (!s || this.chargeKop(sku) === null) return false;
    return isTestPay(s.env) ? s.selling : SHOP_SALES_OPEN && s.selling;
  }

  /** Price line: the official price in roubles once approved and known — never invented, never a test amount. */
  priceOf(sku: ShopSku): string {
    const kop = this.priceKop(sku);
    return kop === null ? 'Цена уточняется' : formatKop(kop);
  }

  /**
   * Robokassa's test mode (staging, the demonstration): what the payment really is, next to the price —
   * «Тестовая оплата 10 ₽ · деньги не списываются» when the amount differs from the price. null outside it.
   */
  testPayLine(sku: ShopSku): string | null {
    if (!isTestPay(this.server?.env) || !this.selling(sku)) return null;
    const charge = this.chargeKop(sku)!;
    return charge === this.priceKop(sku) ? 'Тестовая оплата Robokassa · деньги не списываются' : `Тестовая оплата ${formatKop(charge)} · деньги не списываются`;
  }

  /** The catalog header's word on prices — what the server said, never a promise. */
  priceNote(): string {
    const env = this.server?.env;
    if (env === 'demo' && SHOP_ITEMS.some((i) => this.selling(i.sku))) return 'Демо-оплата · деньги не списываются';
    if (env === 'test' && SHOP_ITEMS.some((i) => this.selling(i.sku))) return 'Тестовая оплата · без списаний';
    if (!SHOP_ITEMS.some((i) => this.priceKop(i.sku) !== null)) return 'Цены уточняются';
    return SHOP_ITEMS.some((i) => this.selling(i.sku)) ? 'Цены в рублях' : 'Продажи не открыты';
  }

  state(item: ShopItemDef): ShopItemState {
    if (item.fighter && !item.skin) return this.fighterState(item);
    const owned = this.owns(item);
    const price = this.priceOf(item.sku);
    if (owned) {
      const worn = this.isWorn(item);
      // «Приобретено» only for a confirmed purchase; a test-mode right and a development grant say so plainly
      const source = paidSource(item.sku);
      const where = item.skin ? 'Облик выбирается в «Моей коллекции» → «Облики бойцов».' : 'Надевается в «Моей коллекции».';
      return {
        item,
        status: worn ? 'equipped' : 'owned',
        chip: worn ? 'НАДЕТО' : 'В КОЛЛЕКЦИИ',
        price: source === 'dev' ? 'Тестовый доступ (dev)' : source === 'test' ? 'Тестовая покупка' : 'Приобретено',
        note:
          source === 'dev'
            ? 'Только сборка разработки: тестовый доступ действует до перезагрузки страницы, не сохраняется и не попадает в PRIME CLOUD.'
            : source === 'test'
              ? `Получено по тестовой оплате Robokassa — деньги не списывались. Это не покупка: доступ действует, пока идёт ${this.server?.env === 'demo' ? 'демонстрационный' : 'тестовый'} режим. ${where}`
              : where,
        owned,
      };
    }
    // (nothing is promised while sales are closed: no «скоро», no date)
    const open = this.selling(item.sku);
    const env = this.server?.env;
    return {
      item,
      status: open ? 'on_sale' : 'soon',
      chip: !open ? 'ПОКА НЕ В ПРОДАЖЕ' : env === 'demo' ? 'ДЕМО-ОПЛАТА' : env === 'test' ? 'ТЕСТ-ОПЛАТА' : 'В ПРОДАЖЕ',
      price,
      note: !open
        ? 'Примерка бесплатна и ничего не открывает. Продажи PRIME SHOP пока не открыты.'
        : isTestPay(env)
          ? `${env === 'demo' ? 'Демонстрационная покупка' : 'Тестовая покупка'} с PRIME ID: оплата в тестовом режиме Robokassa, настоящие деньги не списываются. Примерка бесплатна.`
          : 'Настоящая покупка за рубли с PRIME ID: оплата на защищённой странице Robokassa. Примерка бесплатна и ничего не открывает.',
      owned,
    };
  }

  /** LUCIEN: owned → «ПОЛУЧЕН»; his season → tokens only; before / after it → no sale now. */
  private fighterState(item: ShopItemDef): ShopItemState {
    const id = item.fighter!;
    if (this.events.ownsFighter(id)) {
      return { item, status: 'received', chip: 'ПОЛУЧЕН', price: 'В вашем составе', note: `${FIGHTERS[id].name} остаётся в составе навсегда.`, owned: true };
    }
    const offer = this.events.fighterOffer(id);
    if (offer) {
      const cur = offer.event.currency!;
      const have = this.events.tokens(offer.event);
      return {
        item,
        status: 'seasonal',
        chip: 'СЕЗОННЫЙ',
        price: `${offer.cost} ${cur.name}`,
        note: `Сейчас открывается только за жетоны ${offer.event.title}: у вас ${have} ${plural(have, cur.short)}. За рубли не продаётся.`,
        owned: false,
      };
    }
    const season = this.events.fighterSeason(id);
    if (season?.phase === 'after') {
      // the paid way: only after his season, only for an account that has not opened him for tokens
      const open = this.selling(item.sku);
      return {
        item,
        status: open ? 'on_sale' : 'after_season',
        chip: open ? 'В ПРОДАЖЕ' : 'ПОКА НЕ В ПРОДАЖЕ',
        price: this.priceOf(item.sku),
        note: open ? `${season.event.title} завершён — Люсьена можно открыть в PRIME SHOP.` : `${season.event.title} завершён. Продажи PRIME SHOP пока не открыты.`,
        owned: false,
      };
    }
    return {
      item,
      status: 'upcoming',
      chip: 'СЕЗОННЫЙ',
      price: season ? `Откроется в ${season.event.title}` : 'Сезонный боец',
      note: 'Сезонный боец: открывается за жетоны события, когда оно идёт.',
      owned: false,
    };
  }

  states(): ShopItemState[] {
    return SHOP_ITEMS.map((i) => this.state(i));
  }

  // ------------------------------------------------------------ wardrobe (skins)
  /** The skin a fighter wears: the player's choice, honoured only while it is owned. */
  skinFor(fighter: FighterId): SkinId | null {
    const id = this.store.data.shop?.skins?.[fighter];
    if (!isSkinId(id) || SKINS[id].fighter !== fighter) return null;
    return this.ownsSkin(id) ? id : null;
  }

  /** The look the fighter is shown in everywhere (menu, roster, prep, battle). */
  lookFor(fighter: FighterId): string {
    const skin = this.skinFor(fighter);
    return skin ? SKINS[skin].look : FIGHTERS[fighter].look;
  }

  /**
   * The quick wardrobe of the roster (and anything else that lists one fighter's looks): the standard look first,
   * then every skin made for the fighter. `available` is the same rule setSkin applies (owned through the PRIME
   * NETWORK server's rights — a demonstration right only while the server still lists it); `source` says how.
   */
  wardrobe(fighter: FighterId): WardrobeEntry[] {
    const worn = this.skinFor(fighter);
    return [
      { skin: null, look: FIGHTERS[fighter].look, name: 'Стандарт', available: true, worn: worn === null, source: null },
      ...this.skinsOf(fighter).map((s) => ({ skin: s, look: SKINS[s].look, name: SKINS[s].name, available: this.ownsSkin(s), worn: worn === s, source: paidSource(SKU_OF_SKIN[s]) })),
    ];
  }

  /** The skins made for a fighter (the wardrobe lists them). */
  skinsOf(fighter: FighterId): SkinId[] {
    return (Object.keys(SKINS) as SkinId[]).filter((s) => SKINS[s].fighter === fighter);
  }

  /** Wear an owned skin, or the standard look with null. A skin that is not owned is refused. */
  setSkin(fighter: FighterId, skin: SkinId | null): boolean {
    if (skin !== null && (SKINS[skin]?.fighter !== fighter || !this.ownsSkin(skin))) return false;
    const sh = (this.store.data.shop ??= { skins: {}, equip: {} });
    if (skin === null) {
      if (!(fighter in sh.skins)) return true;
      delete sh.skins[fighter];
    } else {
      if (sh.skins[fighter] === skin) return true;
      sh.skins[fighter] = skin;
    }
    this.store.save();
    return true;
  }

  // ------------------------------------------------------------ purchases (prepared, not live)
  /**
   * Why a purchase of `sku` cannot start, in one line — the same rules as the PRIME CHECKOUT window
   * (src/meta/Checkout.ts buildCheckout; the window itself shows the details). Nothing is charged,
   * granted or created: only the PRIME NETWORK server's confirmed purchases (stage 4, through
   * entitlements.setEntitlements) ever make a paid item owned.
   */
  requestPurchase(sku: ShopSku, signedIn: boolean): PurchaseRefusal {
    const item = shopItem(sku);
    const st = this.state(item);
    const v = buildCheckout({
      sku,
      state: st,
      priceRub: approvedPriceRub(sku),
      salesOpen: SHOP_SALES_OPEN,
      offer: currentOffer(),
      account: { state: signedIn ? 'ready' : 'guest', id: null, nickname: '', email: '' },
      acceptedRevision: 0,
      paymentsReady: CLIENT_PAYMENTS,
      consentTicked: false,
    });
    return refusalOf(v.block, st.note);
  }
}

function refusalOf(block: CheckoutBlock | null, seasonNote: string): PurchaseRefusal {
  switch (block) {
    case 'owned':
      return { ok: false, code: 'owned', message: 'Уже в вашей коллекции.' };
    case 'seasonal_only':
      return { ok: false, code: 'seasonal', message: seasonNote };
    case 'unavailable':
    case 'price_pending':
    case 'sales_closed':
    case 'offer_missing':
      return { ok: false, code: 'not_on_sale', message: 'Продажи PRIME SHOP ещё не открыты: цены уточняются. Сейчас всё можно бесплатно примерить.' };
    case 'guest':
      return { ok: false, code: 'needs_prime_id', message: 'Покупки сохраняются в аккаунте — войдите в PRIME ID.' };
    default:
      return { ok: false, code: 'checkout_unavailable', message: 'Покупка оформляется в окне PRIME CHECKOUT: там видно, что нужно, чтобы продолжить.' };
  }
}

/**
 * Development builds only (`npm run dev`, address bar `?shopgrant=all` or `?shopgrant=sku,sku`):
 * a temporary in-memory grant for testing the wardrobe. Never saved, never uploaded, and dropped
 * from production builds together with devGrant.
 */
export function devShopGrant(param: string | null): boolean {
  if (!import.meta.env?.DEV || !param) return false;
  const all = SHOP_ITEMS.filter((i) => !i.fighter || i.skin).map((i) => i.sku);
  const ids = param === 'all' ? all : param.split(',').filter((s) => (all as string[]).includes(s));
  return ids.length > 0 && devGrant(ids);
}
