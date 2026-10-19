/// <reference path="../pb_data/types.d.ts" />

// PRIME TIME: SHOWDOWN — Alpha 1.8.1 «LOCAL ACCOUNTS»: the database of the local test backend.
//
//   users         PocketBase's own auth collection (email, password hash, verified). Nobody may
//                 create, change or delete a user through the generic API: accounts are created by
//                 POST /api/prime/register (pb_hooks), which checks the nickname and creates the
//                 user and the profile in one transaction. A user sees only their own record.
//   profiles      the public side of a producer: the nickname (as typed) and its unique key.
//                 For now only its owner reads it (leagues and a world ranking come later).
//   saves         one cloud save per account: the SaveData JSON exactly as the game sent it, its
//                 schema, the server revision, the SHA-256 of the text, the last write's id (op).
//   save_history  up to 10 earlier versions per account (replaced, conflict, before a restore).
//
// saves and save_history are read-only for their owner through the generic API; every write goes
// through the hook routes, which check the owner, the revision and the data inside one transaction.

migrate(
  (app) => {
    const env = (k, d) => {
      const v = $os.getenv(k);
      return v ? v : d;
    };

    // ------------------------------------------------------------------ users
    const users = app.findCollectionByNameOrId('users');
    users.listRule = 'id = @request.auth.id';
    users.viewRule = 'id = @request.auth.id';
    users.createRule = null; // only POST /api/prime/register
    users.updateRule = null; // no profile editing in 1.8.1 (password reset goes through its own flow)
    users.deleteRule = null;
    users.manageRule = null;
    users.authRule = ''; // an unverified account may sign in (to resend the email), but cannot use cloud saves
    users.passwordAuth.enabled = true;
    users.passwordAuth.identityFields = ['email'];
    users.oauth2.enabled = false;
    users.otp.enabled = false;
    users.mfa.enabled = false;
    users.authAlert.enabled = false; // «new login» emails: back on with the real SMTP in 1.8.2
    users.authToken.duration = 7 * 24 * 3600;
    users.verificationToken.duration = 24 * 3600;
    users.passwordResetToken.duration = 30 * 60;
    users.emailChangeToken.duration = 30 * 60;
    // no extra personal data on the account: the nickname lives in profiles
    users.fields.removeByName('name');
    users.fields.removeByName('avatar');
    const pw = users.fields.getByName('password');
    pw.min = 8;
    pw.max = 71; // PocketBase caps it at 71 (bcrypt reads at most 72 bytes)
    users.verificationTemplate.subject = 'PRIME TIME: SHOWDOWN — подтвердите email';
    users.verificationTemplate.body = [
      '<p>Здравствуйте!</p>',
      '<p>Это письмо локального тестового сервера PRIME TIME: SHOWDOWN (Alpha 1.8.1). Настоящие письма игрокам пока не отправляются.</p>',
      '<p>Чтобы подтвердить email аккаунта PRIME ID, откройте ссылку:</p>',
      '<p><a class="btn" href="{APP_URL}/_/#/auth/confirm-verification/{TOKEN}" target="_blank" rel="noopener">Подтвердить email</a></p>',
      '<p><i>Ссылка действует 24 часа. Если вы не создавали аккаунт — просто удалите письмо.</i></p>',
    ].join('\n');
    users.resetPasswordTemplate.subject = 'PRIME TIME: SHOWDOWN — новый пароль';
    users.resetPasswordTemplate.body = [
      '<p>Здравствуйте!</p>',
      '<p>Это письмо локального тестового сервера PRIME TIME: SHOWDOWN (Alpha 1.8.1).</p>',
      '<p>Чтобы задать новый пароль аккаунта PRIME ID, откройте ссылку:</p>',
      '<p><a class="btn" href="{APP_URL}/_/#/auth/confirm-password-reset/{TOKEN}" target="_blank" rel="noopener">Задать новый пароль</a></p>',
      '<p><i>Ссылка действует 30 минут и срабатывает один раз. Если вы не просили сменить пароль — просто удалите письмо.</i></p>',
    ].join('\n');
    app.save(users);

    // --------------------------------------------------------------- profiles
    const profiles = new Collection({
      type: 'base',
      name: 'profiles',
      listRule: 'user = @request.auth.id',
      viewRule: 'user = @request.auth.id',
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: 'user', type: 'relation', collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true },
        // the nickname as the player typed it (3–16: Latin or Cyrillic letters, digits, _)
        { name: 'nickname', type: 'text', required: true, min: 3, max: 16, pattern: '^[A-Za-z0-9_А-Яа-яЁё]+$' },
        // lower case, ё → е: «NightProducer» and «nightproducer» are one nickname
        { name: 'nicknameKey', type: 'text', required: true, min: 3, max: 16, pattern: '^[a-z0-9_а-я]+$' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE UNIQUE INDEX `idx_profiles_user` ON `profiles` (`user`)',
        'CREATE UNIQUE INDEX `idx_profiles_nickname_key` ON `profiles` (`nicknameKey`)',
      ],
    });
    app.save(profiles);

    // ------------------------------------------------------------------ saves
    const saveFields = () => [
      { name: 'data', type: 'text', required: true, max: 524288 },
      { name: 'schema', type: 'number', required: true, onlyInt: true, min: 1, max: 1000 },
      { name: 'client', type: 'text', max: 32 },
      { name: 'revision', type: 'number', required: false, onlyInt: true, min: 0 },
      { name: 'hash', type: 'text', required: true, min: 64, max: 64, pattern: '^[a-f0-9]+$' },
      { name: 'device', type: 'text', max: 64 },
      { name: 'op', type: 'text', max: 64 },
    ];
    const saves = new Collection({
      type: 'base',
      name: 'saves',
      listRule: 'owner = @request.auth.id',
      viewRule: 'owner = @request.auth.id',
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: 'owner', type: 'relation', collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true },
        ...saveFields(),
        { name: 'reason', type: 'text', max: 24 },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX `idx_saves_owner` ON `saves` (`owner`)'],
    });
    app.save(saves);

    const history = new Collection({
      type: 'base',
      name: 'save_history',
      listRule: 'owner = @request.auth.id',
      viewRule: 'owner = @request.auth.id',
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: 'owner', type: 'relation', collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true },
        ...saveFields(),
        // why this copy was kept: previous | conflict-cloud | conflict-device | before-restore | damaged
        { name: 'reason', type: 'text', max: 24 },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
      ],
      indexes: ['CREATE INDEX `idx_history_owner` ON `save_history` (`owner`, `created`)', 'CREATE INDEX `idx_history_op` ON `save_history` (`owner`, `op`)'],
    });
    app.save(history);

    // --------------------------------------------------------------- settings
    const s = app.settings();
    s.meta.appName = 'PRIME TIME: SHOWDOWN';
    s.meta.appURL = env('PRIME_APP_URL', 'http://127.0.0.1:8090');
    s.meta.senderName = 'PRIME TIME · локальный тест';
    s.meta.senderAddress = 'no-reply@primetime.local';
    // every email goes to the local catcher (Mailpit): nothing leaves this computer
    s.smtp.enabled = true;
    s.smtp.host = env('PRIME_SMTP_HOST', '127.0.0.1');
    s.smtp.port = parseInt(env('PRIME_SMTP_PORT', '1025'), 10);
    s.smtp.username = '';
    s.smtp.password = '';
    s.smtp.tls = false;
    s.batch.enabled = false;
    s.rateLimits.enabled = true;
    s.rateLimits.rules = [
      { label: '/api/prime/register', audience: '', duration: 60, maxRequests: 5 },
      { label: '*:authWithPassword', audience: '', duration: 60, maxRequests: 10 },
      { label: '*:requestVerification', audience: '', duration: 60, maxRequests: 3 },
      { label: '*:requestPasswordReset', audience: '', duration: 60, maxRequests: 3 },
      { label: '*:confirmVerification', audience: '', duration: 60, maxRequests: 10 },
      { label: '*:confirmPasswordReset', audience: '', duration: 60, maxRequests: 10 },
      { label: '*:auth', audience: '', duration: 60, maxRequests: 20 },
      { label: 'PUT /api/prime/save', audience: '', duration: 60, maxRequests: 30 },
      { label: '/api/prime/', audience: '', duration: 60, maxRequests: 60 },
      { label: '/api/', audience: '', duration: 10, maxRequests: 300 },
    ];
    app.save(s);
  },
  (app) => {
    for (const name of ['save_history', 'saves', 'profiles']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch (_) {
        /* already gone */
      }
    }
  },
);
