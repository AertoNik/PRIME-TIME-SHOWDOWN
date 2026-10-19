#!/usr/bin/env bash
# PRIME TIME: SHOWDOWN — install the PRIME NETWORK API on a fresh Ubuntu 24.04 LTS VPS.
#
# Run ON THE SERVER, from the uploaded project bundle (see docs/PRIME_CLOUD_DEPLOY.md):
#   sudo bash deploy/linux/install.sh api.your-domain.example
#
# What it does (safe to run again — it never touches an existing database or env file):
#   1. installs the Ubuntu packages it needs (unzip, sqlite3, curl, caddy, ufw, age)
#   2. creates the unprivileged system user «pocketbase»
#   3. downloads the pinned PocketBase for Linux from GitHub and checks its SHA-256
#   4. copies hooks, migrations, email pages and server scripts to /opt/primetime
#   5. creates /etc/primetime/pocketbase.env from the template (with a fresh encryption key)
#   6. installs the systemd services (PocketBase, daily backup) and the Caddy HTTPS config
#   7. opens only SSH, 80 and 443 in the firewall
# It does NOT create the superuser, does NOT copy any database and does NOT start registration —
# those are separate, deliberate steps in the guide.
set -euo pipefail

DOMAIN="${1:-}"
PB_VERSION="0.40.5"
# official checksums.txt of v0.40.5 (also in backend/versions.json; npm run accounts keeps them equal)
SHA_AMD64="1dbea1b01eb3dfe64953513859d01e759c96650c4e3264fa4eecd54b769382e4"
SHA_ARM64="570baa1c45d2fb92fc0073582b945ca0ece03cbf9837ccabf49a222f99dd02e3"

APP=/opt/primetime
DATA=/var/lib/primetime/pb_data
ETC=/etc/primetime
BACKUPS=/var/backups/primetime
BUNDLE="$(cd "$(dirname "$0")/../.." && pwd)"

say() { printf '\n==> %s\n' "$*"; }
fail() { echo "ОШИБКА: $*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || fail "запустите через sudo"
[ -f /etc/os-release ] && . /etc/os-release
[ "${ID:-}" = "ubuntu" ] || echo "Внимание: сценарий проверялся по документации для Ubuntu 24.04 (у вас ${PRETTY_NAME:-неизвестно})."
[ -d "$BUNDLE/backend/pb_hooks" ] && [ -d "$BUNDLE/backend/pb_migrations" ] || fail "запускайте из папки проекта: sudo bash deploy/linux/install.sh <домен>"
[ -n "$DOMAIN" ] || fail "укажите домен API: sudo bash deploy/linux/install.sh api.example.com"
case "$DOMAIN" in *[!a-zA-Z0-9.-]* | .* | *..*) fail "домен «$DOMAIN» выглядит неправильно" ;; esac

say "Пакеты Ubuntu"
apt-get update -q
DEBIAN_FRONTEND=noninteractive apt-get install -y -q unzip sqlite3 curl caddy ufw age

say "Системный пользователь pocketbase"
id pocketbase >/dev/null 2>&1 || useradd --system --user-group --home-dir /var/lib/primetime --shell /usr/sbin/nologin pocketbase
mkdir -p "$APP/bin" "$APP/deploy" "$DATA" "$ETC" "$BACKUPS"
chown -R pocketbase:pocketbase /var/lib/primetime "$BACKUPS"
chmod 700 /var/lib/primetime "$DATA" "$BACKUPS"

say "PocketBase $PB_VERSION"
case "$(uname -m)" in
  x86_64) ARCH=amd64; SHA="$SHA_AMD64" ;;
  aarch64 | arm64) ARCH=arm64; SHA="$SHA_ARM64" ;;
  *) fail "неизвестная архитектура $(uname -m)" ;;
esac
if [ "$("$APP/bin/pocketbase" --version 2>/dev/null | awk '{print $3}')" != "$PB_VERSION" ]; then
  TMP="$(mktemp -d)"
  ZIP="pocketbase_${PB_VERSION}_linux_${ARCH}.zip"
  curl -fsSL --retry 3 -o "$TMP/$ZIP" "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/${ZIP}"
  echo "$SHA  $TMP/$ZIP" | sha256sum -c --quiet || fail "SHA-256 не совпал — файл удалён, ничего не установлено"
  unzip -q -o "$TMP/$ZIP" pocketbase -d "$TMP"
  install -m 755 "$TMP/pocketbase" "$APP/bin/pocketbase"
  rm -rf "$TMP"
fi
"$APP/bin/pocketbase" --version

say "Файлы приложения"
rm -rf "$APP/pb_hooks.new" "$APP/pb_migrations.new" "$APP/pb_public.new"
cp -a "$BUNDLE/backend/pb_hooks" "$APP/pb_hooks.new"
cp -a "$BUNDLE/backend/pb_migrations" "$APP/pb_migrations.new"
cp -a "$BUNDLE/backend/pb_public" "$APP/pb_public.new"
for d in pb_hooks pb_migrations pb_public; do
  rm -rf "$APP/$d.previous"
  [ -d "$APP/$d" ] && mv "$APP/$d" "$APP/$d.previous"
  mv "$APP/$d.new" "$APP/$d"
done
install -m 755 "$BUNDLE/deploy/linux/backup.sh" "$BUNDLE/deploy/linux/restore.sh" "$BUNDLE/deploy/linux/healthcheck.sh" "$BUNDLE/deploy/linux/invites.sh" "$BUNDLE/deploy/linux/update.sh" "$APP/deploy/"
mkdir -p "$APP/docs" && cp "$BUNDLE"/docs/PRIME_CLOUD_*.md "$APP/docs/" 2>/dev/null || true
chown -R root:root "$APP"

say "Настройки сервера $ETC/pocketbase.env"
if [ ! -f "$ETC/pocketbase.env" ]; then
  # exactly 16 random bytes as 32 hex characters (PocketBase needs a 32-character key; 128 bits)
  KEY="$(od -An -tx1 -N16 /dev/urandom | tr -d ' \n')"
  [[ "$KEY" =~ ^[0-9a-f]{32}$ ]] || fail "не удалось создать ключ шифрования"
  sed -e "s|^PB_ENCRYPTION_KEY=.*|PB_ENCRYPTION_KEY=$KEY|" -e "s|^PRIME_APP_URL=.*|PRIME_APP_URL=https://$DOMAIN|" "$BUNDLE/deploy/linux/pocketbase.env.example" > "$ETC/pocketbase.env"
  echo "Создан. Сохраните его копию в личных заметках (sudo cat $ETC/pocketbase.env) — без PB_ENCRYPTION_KEY настройки не прочитать."
else
  echo "Уже есть — не изменён."
fi
chown root:pocketbase "$ETC/pocketbase.env"
chmod 640 "$ETC/pocketbase.env"

say "Службы systemd"
install -m 644 "$BUNDLE/deploy/linux/pocketbase.service" /etc/systemd/system/pocketbase.service
install -m 644 "$BUNDLE/deploy/linux/prime-backup.service" /etc/systemd/system/prime-backup.service
install -m 644 "$BUNDLE/deploy/linux/prime-backup.timer" /etc/systemd/system/prime-backup.timer
systemctl daemon-reload
systemctl enable pocketbase.service prime-backup.timer

say "Caddy (HTTPS) для $DOMAIN"
[ -f /etc/caddy/Caddyfile ] && [ ! -f /etc/caddy/Caddyfile.original ] && cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.original
sed "s|API_DOMAIN_PLACEHOLDER|$DOMAIN|" "$BUNDLE/deploy/linux/Caddyfile" > /etc/caddy/Caddyfile
mkdir -p /var/log/caddy && chown caddy:caddy /var/log/caddy
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl enable caddy

say "Firewall: только SSH, 80, 443"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status verbose

say "Запуск"
systemctl restart pocketbase
systemctl reload-or-restart caddy
sleep 2
"$APP/deploy/healthcheck.sh" "$DOMAIN" || true

cat <<EOF

Готово. Дальше по инструкции docs/PRIME_CLOUD_DEPLOY.md:
  1. суперпользователь: ссылка установки — sudo journalctl -u pocketbase | grep pbinstall
     (открыть ТОЛЬКО через SSH-туннель: панель из интернета закрыта, см. инструкцию)
  2. проверить настройки почты в $ETC/pocketbase.env (пока PRIME_MAIL_MODE пуст — писем нет)
  3. создать приглашения:  sudo $APP/deploy/invites.sh create 3
EOF
