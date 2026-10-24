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
#           PRIME_RESTORE_YES=1 (no question), PRIME_RESTORE_SKIP_SERVICE=1 (do not touch systemd — tests),
#           PRIME_LEDGER_DIR / PRIME_DELETIONS_LOG (default: next to the data folder), PRIME_ENV_FILE
#           (default /etc/primetime/pocketbase.env — only read, to warn when live payments are on),
#           PRIME_HEALTH_URL (default http://127.0.0.1:8090/api/health; staging: http://127.0.0.1:8091/api/health)
#
# 1.8.8: the invoice ledger and the deletions note live NEXT TO pb_data and are never rolled back: what the
# archive has is only ADDED (files the live ledger lacks, the higher mark, deletion lines it lacks). At the
# next start PocketBase re-applies paid orders and refunds the restored database lost (prime-shop recover)
# and deletes again the accounts deleted after the copy. Accounts and saves of the archive and of the
# current base are counted and shown before anything is replaced.
set -euo pipefail

ARCHIVE="${1:-}"
DATA_DIR="${PRIME_DATA_DIR:-/var/lib/primetime/pb_data}"
SERVICE="${PRIME_SERVICE:-pocketbase}"
SKIP_SERVICE="${PRIME_RESTORE_SKIP_SERVICE:-}"
LEDGER_DIR="${PRIME_LEDGER_DIR:-$(dirname "$DATA_DIR")/prime-ledger}"
DELETIONS="${PRIME_DELETIONS_LOG:-$(dirname "$DATA_DIR")/prime-deletions.log}"
ENV_FILE="${PRIME_ENV_FILE:-/etc/primetime/pocketbase.env}"
HEALTH_URL="${PRIME_HEALTH_URL:-http://127.0.0.1:8090/api/health}"

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

# 1.8.8: what the archive holds against what the server holds NOW (accounts / saves / orders)
count() { sqlite3 "$1" "select (select count(*) from users)||' '||(select count(*) from saves);" 2>/dev/null || echo "? ?"; }
orders() { sqlite3 "$1" "select count(*) from shop_orders;" 2>/dev/null || echo 0; }
read -r A_USERS A_SAVES <<< "$(count "$DIR/data.db")"
A_ORDERS="$(orders "$DIR/data.db")"
if [ -f "$DATA_DIR/data.db" ]; then
  read -r C_USERS C_SAVES <<< "$(count "$DATA_DIR/data.db")"
  C_ORDERS="$(orders "$DATA_DIR/data.db")"
  echo "Сейчас на сервере: аккаунтов $C_USERS, сохранений $C_SAVES, заказов $C_ORDERS · в архиве: аккаунтов $A_USERS, сохранений $A_SAVES, заказов $A_ORDERS"
  if [ "$A_USERS" != "?" ] && [ "$C_USERS" != "?" ] && [ "$A_USERS" -lt "$C_USERS" ]; then
    echo "ВНИМАНИЕ: в архиве на $((C_USERS - A_USERS)) аккаунт(ов) меньше — созданные после копии аккаунты и их прогресс не вернутся (текущие данные будут отложены, не удалены)." >&2
  fi
fi
# live payments: the restored base loses orders made after the copy — the ledger brings the paid ones back
if [ -r "$ENV_FILE" ] && grep -Eq '^[[:space:]]*PRIME_PAY_MODE[[:space:]]*=[[:space:]]*"?live' "$ENV_FILE"; then
  echo "ВНИМАНИЕ: на этом сервере включены настоящие платежи (PRIME_PAY_MODE=live). Лучше сначала закрыть продажи (PRIME_SHOP_SALES=). После запуска оплаченные после копии заказы восстановятся из журнала счетов — проверьте: deploy/linux/prime-shop.sh ledger" >&2
fi

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

# 1.8.8: the invoice ledger is MERGED, never replaced: files the live ledger lacks are added, the mark is the
# higher of the two — so no invoice number Robokassa has already seen can be handed out again
if [ -d "$DIR/prime-ledger" ]; then
  for envdir in "$DIR/prime-ledger"/*/; do
    [ -d "$envdir" ] || continue
    name="$(basename "$envdir")"
    mkdir -p "$LEDGER_DIR/$name"
    for f in "$envdir"*.json; do
      [ -f "$f" ] || continue
      [ -e "$LEDGER_DIR/$name/$(basename "$f")" ] || cp -p "$f" "$LEDGER_DIR/$name/"
    done
    a_mark="$(tr -dc '0-9' < "$envdir/mark" 2>/dev/null || true)"
    c_mark="$(tr -dc '0-9' < "$LEDGER_DIR/$name/mark" 2>/dev/null || true)"
    if [ -n "$a_mark" ] && { [ -z "$c_mark" ] || [ "$a_mark" -gt "$c_mark" ]; }; then echo "$a_mark" > "$LEDGER_DIR/$name/mark"; fi
  done
  echo "Журнал счетов объединён (ничего не откатилось): $LEDGER_DIR"
fi
# the deletions note: lines the live note lacks are added (accounts deleted before the copy stay deleted)
if [ -f "$DIR/prime-deletions.log" ]; then
  touch "$DELETIONS"
  while IFS= read -r line || [ -n "$line" ]; do
    [ -n "$line" ] || continue
    grep -qxF -- "$line" "$DELETIONS" || echo "$line" >> "$DELETIONS"
  done < "$DIR/prime-deletions.log"
fi
if [ "$(id -u)" = "0" ] && id pocketbase >/dev/null 2>&1; then
  [ -d "$LEDGER_DIR" ] && chown -R pocketbase:pocketbase "$LEDGER_DIR" && chmod -R go-rwx "$LEDGER_DIR"
  [ -f "$DELETIONS" ] && chown pocketbase:pocketbase "$DELETIONS" && chmod 600 "$DELETIONS"
fi

# 1.8.4: the set-aside data holds accounts (also deleted ones) — it must not stay for good
[ -n "${ASIDE:-}" ] && echo "Когда убедитесь, что всё работает, удалите отложенную копию (в ней персональные данные): sudo rm -rf $ASIDE"
if [ -z "$SKIP_SERVICE" ]; then
  systemctl start "$SERVICE"
  for _ in $(seq 1 30); do
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then echo "OK: PocketBase запущен на восстановленных данных (аккаунты, удалённые после этой копии, сервер удалит снова сам; оплаченные после копии заказы восстановит из журнала счетов — см. journalctl и deploy/linux/prime-shop.sh ledger)"; exit 0; fi
    sleep 1
  done
  if journalctl -u "$SERVICE" -n 30 --no-pager 2>/dev/null | grep -q 'message authentication failed'; then
    echo "Причина: в $ENV_FILE другой PB_ENCRYPTION_KEY, чем у сервера, который сделал эту копию." >&2
    echo "Верните прежний ключ (из личных заметок) в этот файл и выполните: sudo systemctl restart $SERVICE" >&2
  fi
  [ -n "${ASIDE:-}" ] && echo "Прежние данные целы: $ASIDE" >&2
  fail "PocketBase не ответил после восстановления: journalctl -u $SERVICE -n 50"
fi
echo "OK: данные восстановлены в $DATA_DIR"
