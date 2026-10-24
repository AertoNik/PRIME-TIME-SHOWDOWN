#!/usr/bin/env bash
# PRIME TIME: SHOWDOWN — PRIME SHOP orders on the server (1.8.8 stage 4): `pocketbase prime-shop …` with the
# server's own settings. Run ON THE SERVER, from the unpacked bundle:
#   sudo bash deploy/linux/prime-shop.sh status
#   sudo bash deploy/linux/prime-shop.sh order 900000001
#   sudo PRIME_INSTANCE=staging bash deploy/linux/prime-shop.sh status      (the separate staging server)
# Commands: status | selftest | orders [N] | order <InvId> | reconcile [InvId] | deliver <InvId> | cancel <InvId>
#           ledger | recover  (1.8.8: the invoice ledger beside the database; after a restore — normally automatic)
#           demo-end           (1.8.8 final: end the demonstration — revoke every demo right; real rights untouched)
#           review <InvId> deliver|note … | refund <InvId> [RUB] reason="…" [api] | refund-done | refund-failed | refund-check
# It prints no password, token or email (docs/PRIME_PAYMENTS.md, §9).
set -euo pipefail
[ "$(id -u)" = "0" ] || { echo "запустите через sudo" >&2; exit 1; }
case "${PRIME_INSTANCE:-production}" in
  production) ETC=/etc/primetime; APP=/opt/primetime; DATA=/var/lib/primetime/pb_data ;;
  staging) ETC=/etc/primetime-staging; APP=/opt/primetime-staging; DATA=/var/lib/primetime-staging/pb_data ;;
  *) echo "PRIME_INSTANCE: production | staging" >&2; exit 1 ;;
esac
[ -r "$ETC/pocketbase.env" ] || { echo "нет $ETC/pocketbase.env" >&2; exit 1; }
load() {
  local file="$1" line key val
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
  done < "$file"
}
load "$ETC/pocketbase.env"
# the Robokassa settings (optional): without them the command still lists orders, payments stay off
[ -r "$ETC/robokassa.env" ] && load "$ETC/robokassa.env"
set +e
runuser -u pocketbase -- "$APP/bin/pocketbase" prime-shop "$@" \
  --dir="$DATA" \
  --hooksDir="$APP/pb_hooks" \
  --migrationsDir="$APP/pb_migrations" \
  --automigrate=false \
  --encryptionEnv=PB_ENCRYPTION_KEY 2>&1 | sed -E 's/^[0-9]{4}\/[0-9]{2}\/[0-9]{2} [0-9:]{8} ?//'
exit "${PIPESTATUS[0]}"
