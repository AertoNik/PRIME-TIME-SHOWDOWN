// PRIME TIME: SHOWDOWN — Alpha 1.8.2: the server's own settings come from its environment, read
// at every start (systemd EnvironmentFile on a VPS, `npm run backend` on the Mac). The database
// keeps whatever was applied last; nothing here is ever sent to the game.
//
//   PRIME_APP_URL               public address of this API (links in the emails)        e.g. https://api.example.com
//   PRIME_SENDER_ADDRESS/NAME   «From» of the emails
//   PRIME_SMTP_HOST/PORT        mail server (Mailpit on the Mac; a real provider on the VPS)
//   PRIME_SMTP_USERNAME/PASSWORD/TLS/AUTH
//   PRIME_TRUSTED_PROXY_HEADER  header with the visitor's IP set by the reverse proxy (Caddy:
//                               X-Forwarded-For) — without it every visitor would share the proxy's
//                               IP and one flood would rate-limit everybody
//
// Secrets (the SMTP password) live in the server's environment file and in the settings table;
// start PocketBase with --encryptionEnv so that table is stored encrypted.

function env(k) {
  return String($os.getenv(k) || '').trim();
}

function applyEnv(app) {
  const s = app.settings();
  let changed = false;
  const set = (obj, key, value) => {
    if (obj[key] !== value) {
      obj[key] = value;
      changed = true;
    }
  };
  if (env('PRIME_APP_URL')) set(s.meta, 'appURL', env('PRIME_APP_URL').replace(/\/+$/, ''));
  if (env('PRIME_APP_NAME')) set(s.meta, 'appName', env('PRIME_APP_NAME'));
  if (env('PRIME_SENDER_ADDRESS')) set(s.meta, 'senderAddress', env('PRIME_SENDER_ADDRESS'));
  if (env('PRIME_SENDER_NAME')) set(s.meta, 'senderName', env('PRIME_SENDER_NAME'));
  if (env('PRIME_SMTP_HOST')) {
    set(s.smtp, 'enabled', true);
    set(s.smtp, 'host', env('PRIME_SMTP_HOST'));
    const port = parseInt(env('PRIME_SMTP_PORT') || '587', 10);
    if (isFinite(port)) set(s.smtp, 'port', port);
    set(s.smtp, 'username', env('PRIME_SMTP_USERNAME'));
    // (empty password stays empty: Mailpit needs none)
    if (s.smtp.password !== env('PRIME_SMTP_PASSWORD')) {
      s.smtp.password = env('PRIME_SMTP_PASSWORD');
      changed = true;
    }
    set(s.smtp, 'tls', env('PRIME_SMTP_TLS') === 'true');
    set(s.smtp, 'authMethod', env('PRIME_SMTP_USERNAME') ? env('PRIME_SMTP_AUTH') || 'PLAIN' : '');
  }
  const proxy = env('PRIME_TRUSTED_PROXY_HEADER');
  if (proxy) {
    const cur = s.trustedProxy.headers;
    if (!(cur && cur.length === 1 && cur[0] === proxy)) {
      s.trustedProxy.headers = [proxy];
      changed = true;
    }
    set(s.trustedProxy, 'useLeftmostIP', false);
  }
  if (changed) app.save(s);
}

module.exports = { applyEnv: applyEnv };
