/// <reference path="../pb_data/types.d.ts" />

// PRIME TIME: SHOWDOWN — Alpha 1.9.0 «PRIME PRODUCER AVATARS».
//
//   producer_looks   one row per PRIME ID: the producer's avatar, frame and backdrop (ids of the catalogue the server
//                    allows — lib/producer_rules.js), a revision (the last confirmed write wins; an edit based on an older
//                    revision is refused, never mixed) and a small rate-limit window. An account without a row shows a
//                    stable default derived from its id — nothing is written for it.
//
// No API rule: written only by POST /api/prime/producer (the signed-in owner), read by the hooks for the public views
// (the league table, a match's opponent card) — only the three ids, never the account. Cascade-deleted with the PRIME ID.
// Purely additive: users, profiles, saves, consents, orders, rights and the league tables are not touched.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    app.save(
      new Collection({
        type: 'base',
        name: 'producer_looks',
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
          { name: 'owner', type: 'relation', collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true },
          { name: 'avatar', type: 'text', required: true, max: 32, pattern: '^[a-z0-9_]+$' },
          { name: 'frame', type: 'text', required: true, max: 32, pattern: '^[a-z0-9_]+$' },
          { name: 'backdrop', type: 'text', required: true, max: 32, pattern: '^[a-z0-9_]+$' },
          { name: 'rev', type: 'number', onlyInt: true, min: 0, max: 100000000 },
          { name: 'window', type: 'number', onlyInt: true, min: 0 },
          { name: 'changes', type: 'number', onlyInt: true, min: 0, max: 100000 },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: ['CREATE UNIQUE INDEX `idx_producer_looks_owner` ON `producer_looks` (`owner`)'],
      }),
    );
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('producer_looks'));
    } catch (_) {
      /* already gone */
    }
  },
);
