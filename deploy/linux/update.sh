#!/usr/bin/env bash
# PRIME TIME: SHOWDOWN — update the PRIME NETWORK API on the VPS to a new project bundle.
#
#   sudo bash deploy/linux/update.sh          (from the NEW uploaded bundle)
#
# 1. a fresh backup first (backup.sh) — the way back
# 2. the new hooks / migrations / email pages / scripts replace the old ones (old ones kept as *.previous)
# 3. PocketBase restarts (new migrations apply on start) and must answer within 30 s
# If it does not: the old files are put back, PocketBase restarts on them, and you get the exact
# restore command for the backup made in step 1 (the database is NOT restored automatically).
set -euo pipefail

APP=/opt/primetime
BUNDLE="$(cd "$(dirname "$0")/../.." && pwd)"
fail() { echo "ОШИБКА: $*" >&2; exit 1; }
[ "$(id -u)" = "0" ] || fail "запустите через sudo"
[ -d "$BUNDLE/backend/pb_hooks" ] || fail "запускайте из папки НОВОЙ версии проекта"

echo "==> Резервная копия перед обновлением"
BACKUP_LINE="$(sudo -u pocketbase "$APP/deploy/backup.sh")" || fail "копия не создана — обновление отменено, ничего не изменено"
echo "$BACKUP_LINE"
ARCHIVE="$(echo "$BACKUP_LINE" | sed -n 's/^OK: \([^ ]*\).*/\1/p')"

echo "==> Новые файлы приложения"
for d in pb_hooks pb_migrations pb_public; do
  rm -rf "$APP/$d.previous"
  cp -a "$APP/$d" "$APP/$d.previous"
  rm -rf "$APP/$d"
  cp -a "$BUNDLE/backend/$d" "$APP/$d"
done
install -m 755 "$BUNDLE"/deploy/linux/{backup.sh,restore.sh,healthcheck.sh,invites.sh,update.sh} "$APP/deploy/"
chown -R root:root "$APP"

echo "==> Перезапуск PocketBase"
systemctl restart pocketbase
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8090/api/health >/dev/null 2>&1; then
    echo "OK: обновлено. Проверка снаружи: $APP/deploy/healthcheck.sh <домен>"
    exit 0
  fi
  sleep 1
done

echo "PocketBase не ответил — возвращаю прежние файлы приложения." >&2
for d in pb_hooks pb_migrations pb_public; do
  rm -rf "$APP/$d"
  mv "$APP/$d.previous" "$APP/$d"
done
systemctl restart pocketbase || true
echo "Лог: sudo journalctl -u pocketbase -n 80" >&2
echo "Если новая миграция успела изменить базу, верните её копию: sudo $APP/deploy/restore.sh $ARCHIVE" >&2
exit 1
