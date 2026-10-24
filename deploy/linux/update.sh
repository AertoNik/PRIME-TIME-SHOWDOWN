#!/usr/bin/env bash
# PRIME TIME: SHOWDOWN — update the PRIME NETWORK API on the VPS to a new project bundle.
#
#   sudo bash deploy/linux/update.sh                          (from the NEW uploaded bundle — production)
#   sudo PRIME_INSTANCE=staging bash deploy/linux/update.sh   (1.8.8: the separate staging server — its own code,
#                                                              database, service and port; production untouched)
#
# 1. a fresh backup first (backup.sh) — the way back
# 2. the new hooks / migrations / email pages / scripts replace the old ones (old ones kept as *.previous)
# 3. PocketBase restarts (new migrations apply on start) and must answer within 30 s
# If it does not: the old files are put back, PocketBase restarts on them, and you get the exact
# restore command for the backup made in step 1 (the database is NOT restored automatically).
# 1.8.8: accounts, saves and orders are counted before and after — fewer afterwards stops with a loud warning
# (the migrations of a release only ADD; a smaller count means something is wrong — nothing is undone
# automatically, the backup of step 1 is the way back).
set -euo pipefail

fail() { echo "ОШИБКА: $*" >&2; exit 1; }
case "${PRIME_INSTANCE:-production}" in
  production) APP=/opt/primetime; DATA=/var/lib/primetime/pb_data; SERVICE=pocketbase; PORT=8090 ;;
  staging) APP=/opt/primetime-staging; DATA=/var/lib/primetime-staging/pb_data; SERVICE=pocketbase-staging; PORT=8091 ;;
  *) fail "PRIME_INSTANCE: production | staging" ;;
esac
DB="$DATA/data.db"
BUNDLE="$(cd "$(dirname "$0")/../.." && pwd)"
[ "$(id -u)" = "0" ] || fail "запустите через sudo"
[ -d "$BUNDLE/backend/pb_hooks" ] || fail "запускайте из папки НОВОЙ версии проекта"
# everything the update touches must exist BEFORE anything changes (set -e would otherwise stop halfway,
# with new files in place and no restart / no way back)
id pocketbase >/dev/null 2>&1 || fail "нет системного пользователя pocketbase"
[ -x "$APP/bin/pocketbase" ] || fail "нет $APP/bin/pocketbase — это не установленный сервер $SERVICE (проверьте PRIME_INSTANCE)"
for d in pb_hooks pb_migrations pb_public; do
  [ -d "$APP/$d" ] || fail "нет $APP/$d — это не установленный сервер $SERVICE (проверьте PRIME_INSTANCE)"
  [ -d "$BUNDLE/backend/$d" ] || fail "в новой версии нет backend/$d — архив неполный"
done
systemctl cat "$SERVICE" >/dev/null 2>&1 || fail "нет службы $SERVICE"

counts() { sqlite3 "file:$DB?mode=ro" "select (select count(*) from users)||' '||(select count(*) from saves)||' '||(select count(*) from save_history);" 2>/dev/null || echo "? ? ?"; }
read -r U0 S0 H0 <<< "$(counts)"
echo "==> Сейчас: аккаунтов $U0, сохранений $S0, копий в истории $H0"

echo "==> Резервная копия перед обновлением ($SERVICE)"
if [ "$SERVICE" = "pocketbase" ]; then
  BACKUP_LINE="$(sudo -u pocketbase "$APP/deploy/backup.sh")" || fail "копия не создана — обновление отменено, ничего не изменено"
else
  # staging: its own data and its own backup folder (the bundle's backup.sh; production's copies untouched)
  BACKUP_LINE="$(PRIME_DATA_DIR="$DATA" PRIME_BACKUP_DIR=/var/backups/primetime-staging bash "$BUNDLE/deploy/linux/backup.sh")" || fail "копия staging не создана — обновление отменено, ничего не изменено"
fi
echo "$BACKUP_LINE"
ARCHIVE="$(echo "$BACKUP_LINE" | sed -n 's/^OK: \([^ ]*\).*/\1/p')"

echo "==> Новые файлы приложения"
for d in pb_hooks pb_migrations pb_public; do
  rm -rf "$APP/$d.previous"
  cp -a "$APP/$d" "$APP/$d.previous"
  rm -rf "$APP/$d"
  cp -a "$BUNDLE/backend/$d" "$APP/$d"
done
mkdir -p "$APP/deploy"
install -m 755 "$BUNDLE"/deploy/linux/{backup.sh,restore.sh,healthcheck.sh,invites.sh,update.sh} "$APP/deploy/"
# 1.8.8: PRIME SHOP orders and the backup check
for extra in prime-shop.sh backup-check.sh; do
  if [ -f "$BUNDLE/deploy/linux/$extra" ]; then install -m 755 "$BUNDLE/deploy/linux/$extra" "$APP/deploy/"; fi
done
# Keep PocketBase access to its working directory and executable (owned by root, readable by the pocketbase
# group — never «chown -R root:root "$APP"»: on a 750 folder that locks the pocketbase user out).
chgrp pocketbase "$APP" "$APP/bin" "$APP/bin/pocketbase"
chmod 750 "$APP" "$APP/bin" "$APP/bin/pocketbase"

for d in pb_hooks pb_migrations pb_public; do
  chown -R root:pocketbase "$APP/$d"
  chmod -R g+rX "$APP/$d"
done

echo "==> Перезапуск $SERVICE"
# (a failed start is judged by the health check below — it puts the previous files back; set -e must not stop here)
systemctl restart "$SERVICE" || true
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    read -r U1 S1 H1 <<< "$(counts)"
    echo "==> После обновления: аккаунтов $U1, сохранений $S1, копий в истории $H1"
    if [ "$U0" != "?" ] && [ "$U1" != "?" ] && { [ "$U1" -lt "$U0" ] || [ "$S1" -lt "$S0" ]; }; then
      echo "ВНИМАНИЕ: аккаунтов или сохранений стало меньше, чем до обновления. Ничего не откатывалось автоматически." >&2
      echo "Проверьте журнал: sudo journalctl -u $SERVICE -n 80. Копия до обновления: $ARCHIVE" >&2
      exit 2
    fi
    echo "OK: обновлено, данные игроков на месте. Проверка снаружи: $APP/deploy/healthcheck.sh <домен>"
    exit 0
  fi
  sleep 1
done

echo "PocketBase не ответил — возвращаю прежние файлы приложения." >&2
for d in pb_hooks pb_migrations pb_public; do
  rm -rf "$APP/$d"
  mv "$APP/$d.previous" "$APP/$d"
done
systemctl restart "$SERVICE" || true
echo "Лог: sudo journalctl -u $SERVICE -n 80" >&2
if [ "$SERVICE" = "pocketbase" ]; then
  echo "Если новая миграция успела изменить базу, верните её копию: sudo $APP/deploy/restore.sh $ARCHIVE" >&2
else
  echo "Если новая миграция успела изменить базу staging: sudo PRIME_DATA_DIR=$DATA PRIME_SERVICE=$SERVICE PRIME_ENV_FILE=/etc/primetime-staging/pocketbase.env PRIME_HEALTH_URL=http://127.0.0.1:$PORT/api/health $APP/deploy/restore.sh $ARCHIVE" >&2
fi
exit 1
