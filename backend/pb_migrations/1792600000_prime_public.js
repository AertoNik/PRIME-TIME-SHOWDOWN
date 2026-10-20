/// <reference path="../pb_data/types.d.ts" />

// PRIME TIME: SHOWDOWN — Alpha 1.8.4 «PUBLIC REGISTRATION & ACCOUNT SAFETY».
//
//   consents          what each account accepted: document, version, language, when, how (registration /
//                     accepted again) — and once the country + «13-17» / «18+» (never the age itself).
//                     No API rule: only the hooks write it, nobody reads it but the owner's export.
//   prime_limits      counters for the email / sign-in / deletion limits (a SHA-256 of the address, not
//                     the address); kept 2 days.
//   prime_challenges  one-time proof-of-work challenges for registration; kept until they expire (10 min).
//
// Also: the verification and password emails in Russian AND English with links to the privacy policy;
// rate limits for the new routes; the server's request log is kept 7 days.
//
// Purely additive: no existing account, profile, save, history, session or invite is touched. Accounts
// made before 1.8.4 simply have no records yet — the game asks them once (see lib/legal.js).

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');

    app.save(
      new Collection({
        type: 'base',
        name: 'consents',
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
          { name: 'user', type: 'relation', collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true },
          // terms | consent | privacy | age
          { name: 'doc', type: 'text', required: true, max: 16, pattern: '^[a-z_]+$' },
          { name: 'version', type: 'number', onlyInt: true, min: 0, max: 100000 },
          { name: 'lang', type: 'text', max: 2 },
          // register | reaccept | notice | declared
          { name: 'action', type: 'text', required: true, max: 16 },
          { name: 'country', type: 'text', max: 2 },
          { name: 'ageBand', type: 'text', max: 8 },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        ],
        indexes: ['CREATE INDEX `idx_consents_user_doc` ON `consents` (`user`, `doc`)'],
      }),
    );

    app.save(
      new Collection({
        type: 'base',
        name: 'prime_limits',
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
          { name: 'kind', type: 'text', required: true, max: 16 },
          { name: 'key', type: 'text', required: true, max: 64 },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        ],
        indexes: ['CREATE INDEX `idx_prime_limits_key` ON `prime_limits` (`kind`, `key`, `created`)', 'CREATE INDEX `idx_prime_limits_created` ON `prime_limits` (`created`)'],
      }),
    );

    app.save(
      new Collection({
        type: 'base',
        name: 'prime_challenges',
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
          { name: 'salt', type: 'text', required: true, min: 32, max: 32, pattern: '^[a-f0-9]+$' },
          { name: 'bits', type: 'number', onlyInt: true, min: 1, max: 32 },
          { name: 'expiresAt', type: 'number', onlyInt: true, min: 0 },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        ],
        indexes: ['CREATE INDEX `idx_prime_challenges_exp` ON `prime_challenges` (`expiresAt`)'],
      }),
    );

    // ------------------------------------------------------------ emails RU + EN
    const game = String($os.getenv('PRIME_GAME_URL') || 'https://primetimeshowdown.online/').trim().replace(/\/*$/, '/');
    const foot = [
      '<hr>',
      `<p style="font-size:12px;color:#777">PRIME TIME: SHOWDOWN · <a href="${game}legal/ru/privacy.html">Политика конфиденциальности</a> · <a href="${game}legal/en/privacy.html">Privacy Policy</a> · primetimeshowdown.official@gmail.com</p>`,
    ];
    users.verificationTemplate.subject = 'PRIME TIME: SHOWDOWN — подтвердите email / confirm your email';
    users.verificationTemplate.body = [
      '<p>Здравствуйте!</p>',
      '<p>Чтобы подтвердить email аккаунта PRIME ID в игре PRIME TIME: SHOWDOWN, откройте ссылку:</p>',
      '<p><a class="btn" href="{APP_URL}/auth/verify/#{TOKEN}" target="_blank" rel="noopener">Подтвердить email</a></p>',
      '<p><i>Ссылка действует 24 часа. Если вы не создавали аккаунт — просто удалите письмо.</i></p>',
      '<hr>',
      '<p>Hello!</p>',
      '<p>To confirm the email of your PRIME ID account in PRIME TIME: SHOWDOWN, open this link:</p>',
      '<p><a class="btn" href="{APP_URL}/auth/verify/#{TOKEN}" target="_blank" rel="noopener">Confirm email</a></p>',
      '<p><i>The link is valid for 24 hours. If you did not create an account, just delete this email.</i></p>',
      ...foot,
    ].join('\n');
    users.resetPasswordTemplate.subject = 'PRIME TIME: SHOWDOWN — новый пароль / new password';
    users.resetPasswordTemplate.body = [
      '<p>Здравствуйте!</p>',
      '<p>Чтобы задать новый пароль аккаунта PRIME ID, откройте ссылку:</p>',
      '<p><a class="btn" href="{APP_URL}/auth/reset/#{TOKEN}" target="_blank" rel="noopener">Задать новый пароль</a></p>',
      '<p><i>Ссылка действует 30 минут и срабатывает один раз. Если вы не просили сменить пароль — просто удалите письмо: пароль останется прежним.</i></p>',
      '<hr>',
      '<p>Hello!</p>',
      '<p>To set a new password for your PRIME ID account, open this link:</p>',
      '<p><a class="btn" href="{APP_URL}/auth/reset/#{TOKEN}" target="_blank" rel="noopener">Set a new password</a></p>',
      '<p><i>The link is valid for 30 minutes and works once. If you did not ask for it, just delete this email — your password stays the same.</i></p>',
      ...foot,
    ].join('\n');
    app.save(users);

    // ------------------------------------------------- rate limits, log retention
    const s = app.settings();
    const added = [
      { label: 'POST /api/prime/challenge', audience: '', duration: 60, maxRequests: 20 },
      { label: '/api/prime/verify/', audience: '', duration: 60, maxRequests: 6 },
      { label: '/api/prime/legal/', audience: '', duration: 60, maxRequests: 10 },
      { label: '/api/prime/account/', audience: '', duration: 60, maxRequests: 6 },
    ];
    const names = added.map((r) => r.label);
    const rules = added.slice();
    // (a Go slice: copied by index, keeping every other rule as it was)
    for (let i = 0; i < s.rateLimits.rules.length; i++) {
      const r = s.rateLimits.rules[i];
      if (names.indexOf(r.label) >= 0) continue;
      rules.push({ label: r.label, audience: r.audience, duration: r.duration, maxRequests: r.maxRequests });
    }
    s.rateLimits.rules = rules;
    s.rateLimits.enabled = true;
    // the request log (IP, browser, address, time) — needed against abuse, kept one week
    s.logs.maxDays = 7;
    app.save(s);
  },
  (app) => {
    for (const name of ['prime_challenges', 'prime_limits', 'consents']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch (_) {
        /* already gone */
      }
    }
  },
);
