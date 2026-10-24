/// <reference path="../pb_data/types.d.ts" />

// PRIME TIME: SHOWDOWN — Alpha 1.8.8 stage 4 «PRIME PAYMENTS × ROBOKASSA».
//
//   shop_orders          one row per purchase attempt: the account, Robokassa's invoice number (InvId,
//                        unique), the item and its name at that moment, the amount in KOPECKS fixed when the
//                        order was made (a later price change never rewrites it), RUB, the offer revision
//                        and its hash, the payment environment (test | live), the state, Robokassa's details
//                        once paid (the exact OutSum text, OpKey, method, fee — never card data), the delivery
//                        and refund times. At most ONE open order per account, item and environment (a unique
//                        index over status = 'pending_payment'): a double tap, two tabs or two devices get
//                        the same order — the same InvId, never a second payment.
//   shop_entitlements    what an account really owns from PRIME SHOP: the item, the order it came from (one
//                        right per order — a repeated notification can never grant twice), where it came from,
//                        the environment, active | revoked (a refund revokes only the right of THAT order).
//                        At most one active right per account, item and environment.
//   shop_payment_events  the audit trail of every order: created, paid, delivered, refused notifications,
//                        returns, refunds, the administrator's decisions — no passwords, no signatures' secrets,
//                        no email, no card data.
//
// None of them has an API rule: players never read, create, change or delete these rows through the generic
// API — only the hook routes (lib/payments.js, owner = the signed-in account) and the administrator's console
// command (`pocketbase prime-shop …`). Deleting a PRIME ID deletes its rights (cascade); its orders stay for
// the accounts, without the link to the person (lib/payments.js, onAccountDelete).
//
// Purely additive: no existing account, profile, save, history, session, invite or consent is touched.
// Applied to the live server only together with a separately approved server update.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');

    const orders = new Collection({
      type: 'base',
      name: 'shop_orders',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        // not required, no cascade: a deleted account leaves its orders without the link (financial record)
        { name: 'user', type: 'relation', collectionId: users.id, required: false, maxSelect: 1, cascadeDelete: false },
        { name: 'invId', type: 'number', required: true, onlyInt: true, min: 1, max: 999999999999999 },
        { name: 'env', type: 'text', required: true, max: 4, pattern: '^(test|live)$' },
        { name: 'provider', type: 'text', max: 16 },
        { name: 'sku', type: 'text', required: true, max: 40, pattern: '^[a-z0-9_]+$' },
        { name: 'item', type: 'text', max: 40 },
        { name: 'kind', type: 'text', max: 16 },
        // the name at the moment of the order (also Robokassa's Description)
        { name: 'title', type: 'text', max: 100 },
        { name: 'amountKop', type: 'number', required: true, onlyInt: true, min: 1, max: 1000000000 },
        { name: 'currency', type: 'text', max: 3 },
        { name: 'offerRevision', type: 'number', onlyInt: true, min: 0, max: 100000 },
        { name: 'offerHash', type: 'text', max: 64 },
        // pending_payment | paid | fulfilled | failed | expired | canceled | refund_pending | refunded | requires_review
        { name: 'status', type: 'text', required: true, max: 20, pattern: '^[a-z_]+$' },
        // which signature algorithm the order was signed with (md5 | sha256 | sha512)
        { name: 'hashAlg', type: 'text', max: 8 },
        // milliseconds since 1970 (server clock)
        { name: 'expiresAt', type: 'number', onlyInt: true, min: 0 },
        { name: 'paidAt', type: 'number', onlyInt: true, min: 0 },
        { name: 'fulfilledAt', type: 'number', onlyInt: true, min: 0 },
        { name: 'refundedAt', type: 'number', onlyInt: true, min: 0 },
        { name: 'lastCheckAt', type: 'number', onlyInt: true, min: 0 },
        // what Robokassa confirmed: the OutSum text exactly as received, how it was learned (result | opstate)
        { name: 'paidSum', type: 'text', max: 24 },
        { name: 'paidVia', type: 'text', max: 16 },
        { name: 'opKey', type: 'text', max: 80 },
        { name: 'paymentMethod', type: 'text', max: 40 },
        { name: 'incCurrLabel', type: 'text', max: 40 },
        { name: 'fee', type: 'text', max: 24 },
        { name: 'reviewReason', type: 'text', max: 40 },
        { name: 'refundKop', type: 'number', onlyInt: true, min: 0, max: 1000000000 },
        { name: 'refundRequestId', type: 'text', max: 64 },
        { name: 'note', type: 'text', max: 300 },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE UNIQUE INDEX `idx_shop_orders_inv` ON `shop_orders` (`invId`)',
        "CREATE UNIQUE INDEX `idx_shop_orders_open` ON `shop_orders` (`user`, `sku`, `env`) WHERE `status` = 'pending_payment'",
        'CREATE INDEX `idx_shop_orders_user` ON `shop_orders` (`user`, `created`)',
        'CREATE INDEX `idx_shop_orders_status` ON `shop_orders` (`status`, `updated`)',
      ],
    });
    app.save(orders);

    app.save(
      new Collection({
        type: 'base',
        name: 'shop_entitlements',
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
          { name: 'user', type: 'relation', collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true },
          { name: 'sku', type: 'text', required: true, max: 40, pattern: '^[a-z0-9_]+$' },
          { name: 'item', type: 'text', max: 40 },
          { name: 'kind', type: 'text', max: 16 },
          { name: 'order', type: 'relation', collectionId: orders.id, required: false, maxSelect: 1, cascadeDelete: false },
          // purchase (a paid order) | support (the administrator, for a paid order that could not be delivered)
          { name: 'source', type: 'text', required: true, max: 16 },
          { name: 'env', type: 'text', required: true, max: 4, pattern: '^(test|live)$' },
          { name: 'status', type: 'text', required: true, max: 8, pattern: '^(active|revoked)$' },
          { name: 'grantedAt', type: 'number', onlyInt: true, min: 0 },
          { name: 'revokedAt', type: 'number', onlyInt: true, min: 0 },
          { name: 'revokeReason', type: 'text', max: 40 },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: [
          "CREATE UNIQUE INDEX `idx_shop_ent_order` ON `shop_entitlements` (`order`) WHERE `order` != ''",
          "CREATE UNIQUE INDEX `idx_shop_ent_active` ON `shop_entitlements` (`user`, `sku`, `env`) WHERE `status` = 'active'",
          'CREATE INDEX `idx_shop_ent_user` ON `shop_entitlements` (`user`)',
        ],
      }),
    );

    app.save(
      new Collection({
        type: 'base',
        name: 'shop_payment_events',
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
          { name: 'order', type: 'relation', collectionId: orders.id, required: false, maxSelect: 1, cascadeDelete: false },
          { name: 'invId', type: 'number', onlyInt: true, min: 0, max: 999999999999999 },
          { name: 'env', type: 'text', max: 4 },
          { name: 'kind', type: 'text', required: true, max: 32, pattern: '^[a-z_]+$' },
          { name: 'code', type: 'text', max: 48 },
          { name: 'detail', type: 'text', max: 500 },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        ],
        indexes: ['CREATE INDEX `idx_shop_events_inv` ON `shop_payment_events` (`invId`, `created`)', 'CREATE INDEX `idx_shop_events_kind` ON `shop_payment_events` (`kind`, `created`)'],
      }),
    );

    // Robokassa's notifications and the return pages (a few per payment; retries are rare)
    const s = app.settings();
    const label = '/api/prime/pay/';
    const rules = [{ label: label, audience: '', duration: 60, maxRequests: 120 }];
    // (a Go slice: copied by index, keeping every other rule as it was)
    for (let i = 0; i < s.rateLimits.rules.length; i++) {
      const r = s.rateLimits.rules[i];
      if (r.label === label) continue;
      rules.push({ label: r.label, audience: r.audience, duration: r.duration, maxRequests: r.maxRequests });
    }
    s.rateLimits.rules = rules;
    app.save(s);
  },
  (app) => {
    for (const name of ['shop_payment_events', 'shop_entitlements', 'shop_orders']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch (_) {
        /* already gone */
      }
    }
    const s = app.settings();
    const rules = [];
    for (let i = 0; i < s.rateLimits.rules.length; i++) {
      const r = s.rateLimits.rules[i];
      if (r.label !== '/api/prime/pay/') rules.push({ label: r.label, audience: r.audience, duration: r.duration, maxRequests: r.maxRequests });
    }
    s.rateLimits.rules = rules;
    app.save(s);
  },
);
