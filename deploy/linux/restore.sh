#!/usr/bin/env bash
# PRIME TIME: SHOWDOWN — restore a PRIME NETWORK backup archive (made by backup.sh).
#
#   sudo /opt/primetime/deploy/restore.sh /var/backups/primetime/pb_data-YYYYMMDD-HHMMSS-NNN.tar.gz
#
# Checks the archive (SHA-256 sums, SQLite integrity), asks for confirmation, stops PocketBase,
# moves the CURRENT data aside (never deletes it: <data>.before-restore-<time>), puts the backup in
# place, starts PocketBase and checks that it answers. Encrypted archives (.age) need the private
# key file: PRIME_AGE_IDENTITY=/path/to/key.txt.
#
# Settings: PRIME_DATA_DIR (default /var/lib/primetime/pb_data), PRIME_SERVICE (pocketbase),
#           PRIME_RESTORE_YES=1 (no question), PRIME_RESTORE_SKIP_SERVICE=1 (do not touch systemd — tests)
set -euo pipefail

ARCHIVE="${1:-}"
DATA_DIR="${PRIME_DATA_DIR:-/var/lib/primetime/pb_data}"
SERVICE="${PRIME_SERVICE:-pocketbase}"
SKIP_SERVICE="${PRIME_RESTORE_SKIP_SERVICE:-}"

fail() { echo "ОШИБКА: $*" >&2; exit 1; }
sumcheck() { if command -v sha256sum >/dev/null 2>&1; then sha256sum -c --quiet SHA256SUMS; else shasum -a 256 -c --quiet SHA256SUMS; fi; }

[ -n "$ARCHIVE" ] && [ -f "$ARCHIVE" ] || fail "укажите архив: restore.sh /путь/pb_data-….tar.gz"
command -v sqlite3 >/dev/null 2>&1 || fail "нет sqlite3"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
SRC="$ARCHIVE"
case "$ARCHIVE" in
  *.age)
    [ -n "${PRIME_AGE_IDENTITY:-}" ] || fail "архив зашифрован: укажите PRIME_AGE_IDENTITY=/путь/к/закрытому/ключу"
    age -d -i "$PRIME_AGE_IDENTITY" -o "$WORK/archive.tar.gz" "$ARCHIVE"
    SRC="$WORK/archive.tar.gz"
    ;;
esac
tar -xzf "$SRC" -C "$WORK"
DIR="$(find "$WORK" -name data.db -not -path '*/storage/*' | head -1 | xargs -I{} dirname "{}")"
[ -n "$DIR" ] || fail "в архиве нет data.db"
(cd "$DIR" && sumcheck) || fail "контрольные суммы не совпали — архив повреждён"
for db in "$DIR"/*.db; do
  [ "$(sqlite3 "$db" 'PRAGMA integrity_check;')" = "ok" ] || fail "$(basename "$db") не прошла проверку целостности"
done
echo "Архив в порядке: $(cat "$DIR/COUNTS" 2>/dev/null || echo '?'), создан $(cat "$DIR/CREATED_UTC" 2>/dev/null || echo '?')"

if [ -z "${PRIME_RESTORE_YES:-}" ]; then
  printf 'Восстановить в %s? Текущие данные будут отложены (не удалены). [y/N] ' "$DATA_DIR"
  read -r answer
  [ "$answer" = "y" ] || [ "$answer" = "Y" ] || fail "отменено"
fi

if [ -z "$SKIP_SERVICE" ]; then systemctl stop "$SERVICE"; fi
if [ -d "$DATA_DIR" ] && [ -n "$(ls -A "$DATA_DIR" 2>/dev/null)" ]; then
  ASIDE="$DATA_DIR.before-restore-$(date -u +%Y%m%d-%H%M%S)"
  mv "$DATA_DIR" "$ASIDE"
  echo "Текущие данные отложены: $ASIDE"
fi
mkdir -p "$DATA_DIR"
cp "$DIR"/*.db "$DATA_DIR/"
if [ -d "$DIR/storage" ]; then cp -a "$DIR/storage" "$DATA_DIR/storage"; fi
if [ "$(id -u)" = "0" ] && id pocketbase >/dev/null 2>&1; then
  chown -R pocketbase:pocketbase "$DATA_DIR"
  chmod 700 "$DATA_DIR"
fi

# 1.8.4: the set-aside data holds accounts (also deleted ones) — it must not stay for good
[ -n "${ASIDE:-}" ] && echo "Когда убедитесь, что всё работает, удалите отложенную копию (в ней персональные данные): sudo rm -rf $ASIDE"
if [ -z "$SKIP_SERVICE" ]; then
  systemctl start "$SERVICE"
  for _ in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:8090/api/health >/dev/null 2>&1; then echo "OK: PocketBase запущен на восстановленных данных (аккаунты, удалённые после этой копии, сервер удалит снова сам — см. journalctl)"; exit 0; fi
    sleep 1
  done
  if journalctl -u "$SERVICE" -n 30 --no-pager 2>/dev/null | grep -q 'message authentication failed'; then
    echo "Причина: в /etc/primetime/pocketbase.env другой PB_ENCRYPTION_KEY, чем у сервера, который сделал эту копию." >&2
    echo "Верните прежний ключ (из личных заметок) в этот файл и выполните: sudo systemctl restart $SERVICE" >&2
  fi
  [ -n "${ASIDE:-}" ] && echo "Прежние данные целы: $ASIDE" >&2
  fail "PocketBase не ответил после восстановления: journalctl -u $SERVICE -n 50"
fi
echo "OK: данные восстановлены в $DATA_DIR"
