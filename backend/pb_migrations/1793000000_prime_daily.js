/// <reference path="../pb_data/types.d.ts" />

// PRIME TIME: SHOWDOWN — Alpha 1.8.9 «DAILY PRIME STREAK».
//
//   daily_streaks   one row per account: the current streak, the best one, the last claimed game day, the day the
//                   free shield last forgave, the number of claims, the dollars paid, the milestones reached
//                   (7 / 14 / 30 / 60 / 100 … → the day first reached — they stay after a broken streak).
//   daily_claims    every daily reward: the game day, its number for the account (seq), the streak day, the amount,
//                   the kind, the milestone, whether the shield or a reset happened, and the cloud save revision
//                   and hash it was written into. ONE claim per account and game day (a unique index — two
//                   devices or two parallel requests can never be paid twice), one per request id (op).
//   a rate limit for /api/prime/daily (status + claim).
//
// Neither collection has an API rule: players read and claim only through the hook routes (lib/daily.js, owner =
// the signed-in account). Deleting a PRIME ID deletes its streak and claims (cascade).
// Purely additive: no existing account, profile, save, history, session, consent, order or right is touched.
// Applied to the live server only together with a separately approved server update.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    app.save(
      new Collection({
        type: 'base',
        name: 'daily_streaks',
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
          { name: 'owner', type: 'relation', collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true },
          { name: 'streak', type: 'number', onlyInt: true, min: 0, max: 1000000 },
          { name: 'best', type: 'number', onlyInt: true, min: 0, max: 1000000 },
          // game days (days since 1970 in Moscow time)
          { name: 'lastDay', type: 'number', onlyInt: true, min: 0, max: 10000000 },
          { name: 'shieldDay', type: 'number', onlyInt: true, min: 0, max: 10000000 },
          { name: 'claims', type: 'number', onlyInt: true, min: 0, max: 1000000 },
          { name: 'total', type: 'number', onlyInt: true, min: 0, max: 1000000000 },
          { name: 'achieved', type: 'json', maxSize: 4000 },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: ['CREATE UNIQUE INDEX `idx_daily_streaks_owner` ON `daily_streaks` (`owner`)'],
      }),
    );
    app.save(
      new Collection({
        type: 'base',
        name: 'daily_claims',
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
          { name: 'owner', type: 'relation', collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true },
          { name: 'op', type: 'text', required: true, max: 64, pattern: '^[A-Za-z0-9_-]{8,64}$' },
          { name: 'day', type: 'number', required: true, onlyInt: true, min: 1, max: 10000000 },
          { name: 'seq', type: 'number', required: true, onlyInt: true, min: 1, max: 1000000 },
          { name: 'streak', type: 'number', required: true, onlyInt: true, min: 1, max: 1000000 },
          { name: 'money', type: 'number', onlyInt: true, min: 0, max: 1000000 },
          { name: 'kind', type: 'text', max: 12, pattern: '^[a-z]+$' },
          { name: 'milestone', type: 'number', onlyInt: true, min: 0, max: 1000000 },
          { name: 'label', type: 'text', max: 80 },
          { name: 'shield', type: 'bool' },
          { name: 'reset', type: 'bool' },
          { name: 'first', type: 'bool' },
          // the cloud save revision and hash the reward was written into
          { name: 'revision', type: 'number', onlyInt: true, min: 0 },
          { name: 'hash', type: 'text', max: 64 },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        ],
        indexes: [
          'CREATE UNIQUE INDEX `idx_daily_claims_day` ON `daily_claims` (`owner`, `day`)',
          'CREATE UNIQUE INDEX `idx_daily_claims_op` ON `daily_claims` (`owner`, `op`)',
          'CREATE UNIQUE INDEX `idx_daily_claims_seq` ON `daily_claims` (`owner`, `seq`)',
        ],
      }),
    );

    const s = app.settings();
    const label = '/api/prime/daily';
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
    for (const name of ['daily_claims', 'daily_streaks']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch (_) {
        /* not there */
      }
    }
    const s = app.settings();
    const rules = [];
    for (let i = 0; i < s.rateLimits.rules.length; i++) {
      const r = s.rateLimits.rules[i];
      if (r.label !== '/api/prime/daily') rules.push({ label: r.label, audience: r.audience, duration: r.duration, maxRequests: r.maxRequests });
    }
    s.rateLimits.rules = rules;
    app.save(s);
  },
);
