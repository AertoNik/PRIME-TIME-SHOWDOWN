#!/usr/bin/env bash
# PRIME TIME: SHOWDOWN — is there a FRESH, READABLE backup? (1.8.8; read-only: changes nothing, stops nothing)
#
#   sudo bash deploy/linux/backup-check.sh          (on the server, or from /opt/primetime/deploy after update.sh)
#
# Checks the newest archive of backup.sh: its age (default: at most 26 hours — the daily timer plus slack), that
# it unpacks, its SHA-256 sums, SQLite's integrity check, the accounts / saves / orders it holds against the live
# database, that the invoice ledger is inside, and whether an ENCRYPTED copy for outside storage exists
# (PRIME_BACKUP_AGE_RECIPIENT) and is sent out (PRIME_BACKUP_UPLOAD_CMD). Exit code 0 = all good, 1 = a problem.
#
# Settings (environment, like backup.sh): PRIME_BACKUP_DIR (/var/backups/primetime), PRIME_DATA_DIR
# (/var/lib/primetime/pb_data), PRIME_BACKUP_MAX_AGE_H (26), PRIME_ENV_FILE (/etc/primetime/pocketbase.env —
# only read, for the outside-copy settings).
set -uo pipefail
BACKUP_DIR="${PRIME_BACKUP_DIR:-/var/backups/primetime}"
DATA_DIR="${PRIME_DATA_DIR:-/var/lib/primetime/pb_data}"
MAX_AGE_H="${PRIME_BACKUP_MAX_AGE_H:-26}"
ENV_FILE="${PRIME_ENV_FILE:-/etc/primetime/pocketbase.env}"
PROBLEMS=0
ok() { echo "OK: $*"; }
bad() {
  echo "ПРОБЛЕМА: $*" >&2
  PROBLEMS=$((PROBLEMS + 1))
}
sumcheck() { if command -v sha256sum >/dev/null 2>&1; then sha256sum -c --quiet SHA256SUMS; else shasum -a 256 -c --quiet SHA256SUMS; fi; }
mtime() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1"; }
setting() { [ -r "$ENV_FILE" ] && sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$ENV_FILE" | tail -1 | tr -d '"' || true; }

command -v sqlite3 >/dev/null 2>&1 || { echo "нет sqlite3" >&2; exit 1; }
NEWEST="$(ls -1t "$BACKUP_DIR"/pb_data-*.tar.gz 2>/dev/null | head -1 || true)"
if [ -z "$NEWEST" ]; then
  bad "в $BACKUP_DIR нет ни одной копии (pb_data-*.tar.gz) — запустите: sudo systemctl start prime-backup"
  exit 1
fi
AGE_H=$(( ($(date +%s) - $(mtime "$NEWEST")) / 3600 ))
if [ "$AGE_H" -le "$MAX_AGE_H" ]; then ok "свежая копия: $(basename "$NEWEST") (${AGE_H} ч назад)"; else bad "последней копии ${AGE_H} ч (больше ${MAX_AGE_H}): проверьте таймер — systemctl list-timers prime-backup.timer"; fi
echo "Копий на сервере: $(ls -1 "$BACKUP_DIR"/pb_data-*.tar.gz 2>/dev/null | wc -l | tr -d ' ')"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
if tar -xzf "$NEWEST" -C "$WORK" 2>/dev/null; then
  DIR="$(find "$WORK" -name data.db -not -path '*/storage/*' | head -1 | xargs -I{} dirname "{}")"
  if [ -n "$DIR" ] && (cd "$DIR" && sumcheck) && [ "$(sqlite3 "$DIR/data.db" 'PRAGMA integrity_check;')" = "ok" ]; then
    ok "копия читается: контрольные суммы и проверка целостности SQLite пройдены"
    A="$(sqlite3 "$DIR/data.db" "select (select count(*) from users)||' '||(select count(*) from saves);" 2>/dev/null || echo '? ?')"
    L="$(sqlite3 "file:$DATA_DIR/data.db?mode=ro" "select (select count(*) from users)||' '||(select count(*) from saves);" 2>/dev/null || echo '? ?')"
    echo "В копии: аккаунтов ${A% *}, сохранений ${A#* } · сейчас в базе: аккаунтов ${L% *}, сохранений ${L#* }"
    if sqlite3 "$DIR/data.db" "select 1 from sqlite_master where name='shop_orders';" 2>/dev/null | grep -q 1; then
      if [ -d "$DIR/prime-ledger" ]; then ok "журнал счетов в копии: $(find "$DIR/prime-ledger" -name '*.json' | wc -l | tr -d ' ') заказ(ов)"; else bad "в копии нет журнала счетов (prime-ledger) — обновите backup.sh до версии 1.8.8"; fi
    fi
  else
    bad "копия $(basename "$NEWEST") не прошла проверку (суммы или целостность)"
  fi
else
  bad "копия $(basename "$NEWEST") не распаковывается"
fi

# outside the server: an encrypted copy (age) and its upload
RECIPIENT="${PRIME_BACKUP_AGE_RECIPIENT:-$(setting PRIME_BACKUP_AGE_RECIPIENT)}"
UPLOAD="${PRIME_BACKUP_UPLOAD_CMD:-$(setting PRIME_BACKUP_UPLOAD_CMD)}"
if [ -n "$RECIPIENT" ]; then
  if [ -f "$NEWEST.age" ]; then ok "зашифрованная копия для хранения вне сервера: $(basename "$NEWEST").age"; else bad "ключ age задан, но у последней копии нет .age"; fi
  if [ -n "$UPLOAD" ]; then ok "выгрузка зашифрованных копий вне сервера настроена"; else bad "зашифрованные копии остаются на этом же сервере (PRIME_BACKUP_UPLOAD_CMD пуст) — скачивайте их к себе регулярно (docs/PRIME_CLOUD_BACKUP.md)"; fi
else
  bad "копии хранятся только на этом сервере: нет PRIME_BACKUP_AGE_RECIPIENT (шифрование для хранения вне VPS) — при потере диска пропадут и база, и копии"
fi

[ "$PROBLEMS" -eq 0 ] && echo "Итог: резервные копии в порядке." || echo "Итог: проблем — $PROBLEMS (см. выше)." >&2
[ "$PROBLEMS" -eq 0 ]
