/// <reference path="../pb_data/types.d.ts" />

// PRIME TIME: SHOWDOWN — Alpha 1.8.8 stage 3 «PRIME CHECKOUT».
//
//   consents.docHash   which exact text was accepted: the SHA-256 of the published PRIME SHOP offer
//                      (doc «shop_offer», version = the offer's revision). Empty for the older documents.
//   one consent per account and offer revision (a unique index limited to doc = 'shop_offer': two
//                      parallel «accept» requests cannot write two rows; existing rows are not affected).
//   a rate limit for the new /api/prime/shop/ routes.
//
// Purely additive: no existing account, profile, save, history, session, invite or consent changes. No
// order or purchase collection yet — those come with payments (stage 4, see docs/PRIME_CHECKOUT.md).
// Applied to the live server only together with a separately approved server update.

migrate(
  (app) => {
    const c = app.findCollectionByNameOrId('consents');
    c.fields.add(new TextField({ name: 'docHash', max: 64, pattern: '^[a-f0-9]{64}$' }));
    c.addIndex('idx_consents_shop_offer', true, '`user`, `version`', "`doc` = 'shop_offer'");
    app.save(c);

    const s = app.settings();
    const label = '/api/prime/shop/';
    const rules = [{ label: label, audience: '', duration: 60, maxRequests: 30 }];
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
    const c = app.findCollectionByNameOrId('consents');
    c.removeIndex('idx_consents_shop_offer');
    c.fields.removeByName('docHash');
    app.save(c);
    const s = app.settings();
    const rules = [];
    for (let i = 0; i < s.rateLimits.rules.length; i++) {
      const r = s.rateLimits.rules[i];
      if (r.label !== '/api/prime/shop/') rules.push({ label: r.label, audience: r.audience, duration: r.duration, maxRequests: r.maxRequests });
    }
    s.rateLimits.rules = rules;
    app.save(s);
  },
);
