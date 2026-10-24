/// <reference path="../pb_data/types.d.ts" />

// PRIME TIME: SHOWDOWN — Alpha 1.8.8 final «PRIME SHOP demonstration».
//
// The payment environment of an order and of a right may now also be «demo»: the official site's
// demonstration of the purchase (Robokassa's test mode, PRIME_PAY_MODE=demo — lib/payments.js). Its orders and
// rights stay apart from the real ones by this field, by their own invoice range and by their own ledger; a
// live server never counts them.
//
// Only the allowed values of `env` change (test | live → test | live | demo). No row is read, changed or
// removed; down restores the previous pattern.

migrate(
  (app) => {
    for (const name of ['shop_orders', 'shop_entitlements']) {
      const c = app.findCollectionByNameOrId(name);
      c.fields.getByName('env').pattern = '^(test|live|demo)$';
      app.save(c);
    }
  },
  (app) => {
    for (const name of ['shop_orders', 'shop_entitlements']) {
      const c = app.findCollectionByNameOrId(name);
      c.fields.getByName('env').pattern = '^(test|live)$';
      app.save(c);
    }
  },
);
