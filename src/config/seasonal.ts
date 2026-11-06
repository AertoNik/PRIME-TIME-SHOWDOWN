import { EVENTS, type EventDef } from './events.config';
import { SHOP_ITEMS, type ShopItemDef, type ShopSku } from './shop.config';

// Alpha 1.9.5 — SEASONAL ITEMS: one rule for characters, skins and effects.
//
// An item is SEASONAL when an event's exchange gives it for the event's currency (events.config.ts: `fighters`,
// `shop` for cosmetics, `skins`). The PRIME SHOP entry of such an item is the SAME item (the same fighter id,
// cosmetic id or skin id — one ownership, never a duplicate):
//   before its event   not sold (the shop shows «Сезонный»)
//   during its event   only for the event's currency (EventManager), never for roubles (server: «seasonal_only»)
//   after its event    for roubles in PRIME SHOP — only once its price is approved and an offer revision in force
//                      lists it (server: approved prices, payments.js); until then «ожидает продажи»
//   obtained           for tokens or by purchase: kept for good; never offered again (server: «owned»)
// A future season (New Year…) needs data only: the event with its dates and exchange, and a SHOP_ITEMS entry for each
// item that is to be sold after it. An exchange item without a SHOP_ITEMS entry simply stays a seasonal reward.
// The end of the season is the SERVER's clock (lib/checkout.js; the game reads the server's time — serverClock.ts).

export interface ItemSeason {
  event: EventDef;
  /** The price in the event's currency. */
  cost: number;
}

/** The event whose exchange gives this shop item (null: not a seasonal item). */
export function seasonOf(item: ShopItemDef, registry: readonly EventDef[] = EVENTS): ItemSeason | null {
  for (const e of registry) {
    if (item.skin) {
      const x = e.skins?.find((s) => s.skin === item.skin);
      if (x) return { event: e, cost: x.cost };
    } else if (item.cosmetic) {
      const x = e.shop.find((s) => s.cosmetic === item.cosmetic);
      if (x) return { event: e, cost: x.cost };
    } else if (item.fighter) {
      const x = e.fighters?.find((f) => f.fighter === item.fighter);
      if (x) return { event: e, cost: x.cost };
    }
  }
  return null;
}

/** The skus of seasonal items (sold for roubles only after their event). */
export function seasonalSkus(registry: readonly EventDef[] = EVENTS): ShopSku[] {
  return SHOP_ITEMS.filter((i) => seasonOf(i, registry)).map((i) => i.sku);
}
