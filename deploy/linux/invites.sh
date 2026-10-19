#!/usr/bin/env bash
# PRIME TIME: SHOWDOWN — PRIME NETWORK invites on the VPS (over SSH; never from a browser).
#
#   sudo /opt/primetime/deploy/invites.sh create 3 days=14 note=друзья
#   sudo /opt/primetime/deploy/invites.sh list            (active)   |  list all
#   sudo /opt/primetime/deploy/invites.sh stats
#   sudo /opt/primetime/deploy/invites.sh revoke <id или код>
#
# Runs the PocketBase console command as the «pocketbase» user with the server's settings (the
# encryption key is needed to open the settings). Codes are printed once; only their hash is stored.
#
# The settings file is read the way systemd reads it (KEY=VALUE per line, optional quotes) and never
# executed as shell code: a password with $, quotes or spaces reaches PocketBase exactly as written —
# otherwise every run would store a mangled SMTP password over the right one.
set -euo pipefail
[ "$(id -u)" = "0" ] || { echo "запустите через sudo" >&2; exit 1; }

ENV_FILE=/etc/primetime/pocketbase.env
[ -r "$ENV_FILE" ] || { echo "нет $ENV_FILE — сначала deploy/linux/install.sh" >&2; exit 1; }

while IFS= read -r line || [ -n "$line" ]; do
  line="${line#"${line%%[![:space:]]*}"}"
  case "$line" in '' | '#'* | ';'*) continue ;; esac
  case "$line" in *=*) ;; *) continue ;; esac
  key="${line%%=*}"
  key="${key%"${key##*[![:space:]]}"}"
  val="${line#*=}"
  val="${val#"${val%%[![:space:]]*}"}"
  val="${val%"${val##*[![:space:]]}"}"
  [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
  if [ "${#val}" -ge 2 ]; then
    case "$val" in \"*\" | \'*\') val="${val:1:${#val}-2}" ;; esac
  fi
  export "$key=$val"
done < "$ENV_FILE"

# runuser keeps the environment above (sudo would drop it); PocketBase prefixes lines with a timestamp
set +e
runuser -u pocketbase -- /opt/primetime/bin/pocketbase invites "$@" \
  --dir=/var/lib/primetime/pb_data \
  --hooksDir=/opt/primetime/pb_hooks \
  --migrationsDir=/opt/primetime/pb_migrations \
  --automigrate=false \
  --encryptionEnv=PB_ENCRYPTION_KEY 2>&1 | sed -E 's/^[0-9]{4}\/[0-9]{2}\/[0-9]{2} [0-9:]{8} ?//'
exit "${PIPESTATUS[0]}"
