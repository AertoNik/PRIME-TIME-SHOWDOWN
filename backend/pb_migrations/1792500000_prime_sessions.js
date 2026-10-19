/// <reference path="../pb_data/types.d.ts" />

// PRIME TIME: SHOWDOWN — Alpha 1.8.3 «PRIME CLOUD 2.0»: one active game session per PRIME ID.
//
//   game_sessions   one record per account: which page (tab / browser / device) may play the account
//                   and change its cloud save right now. The page keeps a random secret key in memory;
//                   only its SHA-256 is stored here. Every claim raises `generation` by one (a fencing
//                   token): a save, archive or restore request must name the current key AND
//                   generation, checked inside the same transaction as the write — so a request from
//                   a page that lost the session can never land after the new page took over.
//                   No API rule at all: only the hook routes (/api/prime/session/…) and a superuser.
//
// Purely additive: no account, profile, save, history or invite record is touched.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');

    const sessions = new Collection({
      type: 'base',
      name: 'game_sessions',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: 'user', type: 'relation', collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true },
        // sha256("prime-session:v1:" + the page's key) — the key itself never leaves the page except in its own requests
        { name: 'keyHash', type: 'text', max: 64 },
        // +1 on every claim (fencing token)
        { name: 'generation', type: 'number', onlyInt: true, min: 0 },
        // milliseconds since 1970 (server clock)
        { name: 'claimedAt', type: 'number', onlyInt: true, min: 0 },
        { name: 'heartbeatAt', type: 'number', onlyInt: true, min: 0 },
        { name: 'releasedAt', type: 'number', onlyInt: true, min: 0 },
        // a coarse device name for the message on the other device («iPhone · Safari»), and the browser's random id
        { name: 'label', type: 'text', max: 48 },
        { name: 'device', type: 'text', max: 64 },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX `idx_game_sessions_user` ON `game_sessions` (`user`)'],
    });
    app.save(sessions);

    // the session routes: a heartbeat every ~20 s, claims only on opening the game or «Продолжить здесь»
    const s = app.settings();
    const rules = [{ label: '/api/prime/session/', audience: '', duration: 60, maxRequests: 60 }];
    // (a Go slice: copied by index, keeping every other rule as it was)
    for (let i = 0; i < s.rateLimits.rules.length; i++) {
      const r = s.rateLimits.rules[i];
      if (r.label === '/api/prime/session/') continue;
      rules.push({ label: r.label, audience: r.audience, duration: r.duration, maxRequests: r.maxRequests });
    }
    s.rateLimits.rules = rules;
    s.rateLimits.enabled = true;
    app.save(s);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('game_sessions'));
    } catch (_) {
      /* already gone */
    }
    const s = app.settings();
    const rules = [];
    for (let i = 0; i < s.rateLimits.rules.length; i++) {
      const r = s.rateLimits.rules[i];
      if (r.label !== '/api/prime/session/') rules.push({ label: r.label, audience: r.audience, duration: r.duration, maxRequests: r.maxRequests });
    }
    s.rateLimits.rules = rules;
    app.save(s);
  },
);
