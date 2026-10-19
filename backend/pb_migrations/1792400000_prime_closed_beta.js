/// <reference path="../pb_data/types.d.ts" />

// PRIME TIME: SHOWDOWN — Alpha 1.8.2 «PRIME CLOUD: CLOSED BETA», stage 1.
//
//   invites   PRIME NETWORK invites: only a one-way hash of each code is stored (SHA-256 of the
//             normalised code); the code itself is shown once, to the administrator, when it is
//             created (`pocketbase invites create …`). No API rule at all: ordinary users cannot
//             list, read, create, change or delete invites — only the server (hooks / console
//             command) and a superuser can.
//
// The email links now open the game's own small pages (pb_public/auth/…) instead of PocketBase's
// dashboard pages, so on a real server the dashboard (/_/) can stay closed to the internet.
//
// Purely additive: no existing account, profile, save or history record is touched.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');

    const invites = new Collection({
      type: 'base',
      name: 'invites',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        // sha256("prime-invite:v1:" + normalised code) — the code cannot be read back from it
        { name: 'codeHash', type: 'text', required: true, min: 64, max: 64, pattern: '^[a-f0-9]+$' },
        // the last 4 characters, so the administrator can tell codes apart (20 bits: useless for guessing)
        { name: 'hint', type: 'text', max: 8 },
        { name: 'note', type: 'text', max: 80 },
        { name: 'maxUses', type: 'number', required: true, onlyInt: true, min: 1, max: 1000 },
        { name: 'uses', type: 'number', onlyInt: true, min: 0 },
        { name: 'expiresAt', type: 'date' },
        { name: 'revokedAt', type: 'date' },
        { name: 'usedAt', type: 'date' },
        { name: 'usedBy', type: 'relation', collectionId: users.id, maxSelect: 1000, cascadeDelete: false },
        { name: 'createdBy', type: 'text', max: 64 },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX `idx_invites_code` ON `invites` (`codeHash`)'],
    });
    app.save(invites);

    users.verificationTemplate.body = [
      '<p>Здравствуйте!</p>',
      '<p>Это письмо сервера PRIME NETWORK игры PRIME TIME: SHOWDOWN.</p>',
      '<p>Чтобы подтвердить email аккаунта PRIME ID, откройте ссылку:</p>',
      '<p><a class="btn" href="{APP_URL}/auth/verify/#{TOKEN}" target="_blank" rel="noopener">Подтвердить email</a></p>',
      '<p><i>Ссылка действует 24 часа. Если вы не создавали аккаунт — просто удалите письмо.</i></p>',
    ].join('\n');
    users.resetPasswordTemplate.body = [
      '<p>Здравствуйте!</p>',
      '<p>Это письмо сервера PRIME NETWORK игры PRIME TIME: SHOWDOWN.</p>',
      '<p>Чтобы задать новый пароль аккаунта PRIME ID, откройте ссылку:</p>',
      '<p><a class="btn" href="{APP_URL}/auth/reset/#{TOKEN}" target="_blank" rel="noopener">Задать новый пароль</a></p>',
      '<p><i>Ссылка действует 30 минут и срабатывает один раз. Если вы не просили сменить пароль — просто удалите письмо.</i></p>',
    ].join('\n');
    app.save(users);

    // registration through invites: a little stricter than before (codes are 130-bit, this only slows floods)
    const s = app.settings();
    const rules = [
      { label: '/api/prime/register', audience: '', duration: 60, maxRequests: 5 },
      { label: 'GET /api/prime/config', audience: '', duration: 60, maxRequests: 30 },
    ];
    // (a Go slice: copied by index, keeping every other rule as it was)
    for (let i = 0; i < s.rateLimits.rules.length; i++) {
      const r = s.rateLimits.rules[i];
      if (r.label === '/api/prime/register' || r.label === 'GET /api/prime/config') continue;
      rules.push({ label: r.label, audience: r.audience, duration: r.duration, maxRequests: r.maxRequests });
    }
    s.rateLimits.rules = rules;
    s.rateLimits.enabled = true;
    app.save(s);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('invites'));
    } catch (_) {
      /* already gone */
    }
  },
);
