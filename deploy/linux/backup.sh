#!/usr/bin/env bash
# PRIME TIME: SHOWDOWN — PRIME NETWORK backup (future VPS; also runs on a Mac for the checks).
#
# A CONSISTENT copy of the PocketBase data while the server keeps running: SQLite's own online backup
# (`.backup`) for data.db — never a raw copy of a database in the middle of a write —
# plus uploaded files (storage/). Every copy is integrity-checked, gets SHA-256 sums, is packed into
# one archive, optionally encrypted for an outside storage, and only the newest N are kept.
# 1.8.8: also the invoice ledger (prime-ledger/ next to pb_data: the highest invoice number ever issued, every
# order, every verified payment and refund) and the deletions note — so a server rebuilt from an outside copy
# never hands out an old invoice number again; restore.sh MERGES them, never rolls them back.
#
# Run by hand:   sudo /opt/primetime/deploy/backup.sh
# Daily:         prime-backup.timer (see docs/PRIME_CLOUD_BACKUP.md)
#
# Settings (environment; defaults are the VPS layout):
#   PRIME_DATA_DIR               /var/lib/primetime/pb_data
#   PRIME_BACKUP_DIR             /var/backups/primetime
#   PRIME_BACKUP_KEEP            14            newest archives kept on this server
#   PRIME_BACKUP_AGE_RECIPIENT   (empty)       an `age` PUBLIC key: an extra .age copy of each archive is
#                                              encrypted with it for outside storage (the private key stays
#                                              with the developer, never on the server)
#   PRIME_BACKUP_UPLOAD_CMD      (empty)       a command run with the ENCRYPTED copy's path as $1 — e.g. an
#                                              rclone copy to an outside storage chosen later. Empty = no
#                                              upload; without an age key nothing is ever uploaded.
#   PRIME_LEDGER_DIR             <data dir>/../prime-ledger      the invoice ledger (1.8.8)
#   PRIME_DELETIONS_LOG          <data dir>/../prime-deletions.log
set -euo pipefail

DATA_DIR="${PRIME_DATA_DIR:-/var/lib/primetime/pb_data}"
BACKUP_DIR="${PRIME_BACKUP_DIR:-/var/backups/primetime}"
KEEP="${PRIME_BACKUP_KEEP:-14}"
AGE_RECIPIENT="${PRIME_BACKUP_AGE_RECIPIENT:-}"
UPLOAD_CMD="${PRIME_BACKUP_UPLOAD_CMD:-}"
LEDGER_DIR="${PRIME_LEDGER_DIR:-$(dirname "$DATA_DIR")/prime-ledger}"
DELETIONS="${PRIME_DELETIONS_LOG:-$(dirname "$DATA_DIR")/prime-deletions.log}"

umask 077
fail() { echo "ОШИБКА: $*" >&2; exit 1; }
sum() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }

command -v sqlite3 >/dev/null 2>&1 || fail "нет sqlite3 (Ubuntu: sudo apt install sqlite3)"
[ -f "$DATA_DIR/data.db" ] || fail "нет базы $DATA_DIR/data.db"
case "$KEEP" in '' | *[!0-9]*) fail "PRIME_BACKUP_KEEP должен быть числом" ;; esac
[ "$KEEP" -ge 1 ] || fail "PRIME_BACKUP_KEEP должен быть не меньше 1"

STAMP="$(date -u +%Y%m%d-%H%M%S)-$$"
NAME="pb_data-$STAMP"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
OUT="$WORK/$NAME"
mkdir -p "$OUT"

# 1.8.4: auxiliary.db (PocketBase's request log: visitors' IP addresses, kept 7 days) is NOT copied —
# a backup must not keep IP addresses for its 14 days; PocketBase starts a fresh log after a restore.
for db in data.db; do
  [ -f "$DATA_DIR/$db" ] || continue
  sqlite3 "$DATA_DIR/$db" ".backup '$OUT/$db'" || fail "не удалось скопировать $db"
  [ "$(sqlite3 "$OUT/$db" 'PRAGMA integrity_check;')" = "ok" ] || fail "копия $db не прошла проверку целостности"
done
if [ -d "$DATA_DIR/storage" ]; then cp -a "$DATA_DIR/storage" "$OUT/storage"; fi
# 1.8.8: the invoice ledger and the deletions note (outside the database — kept with it in the archive)
if [ -d "$LEDGER_DIR" ]; then cp -a "$LEDGER_DIR" "$OUT/prime-ledger"; fi
if [ -f "$DELETIONS" ]; then cp -a "$DELETIONS" "$OUT/prime-deletions.log"; fi
(cd "$OUT" && sum ./*.db > SHA256SUMS)
COUNTS="$(sqlite3 "$OUT/data.db" "select 'аккаунтов '||(select count(*) from users)||', сохранений '||(select count(*) from saves);" 2>/dev/null || echo 'таблицы PRIME ещё не созданы')"
# (1.8.8: orders and rights too, once the PRIME SHOP tables exist)
SHOP="$(sqlite3 "$OUT/data.db" "select ', заказов '||(select count(*) from shop_orders)||', прав на покупки '||(select count(*) from shop_entitlements where status='active');" 2>/dev/null || true)"
COUNTS="$COUNTS$SHOP"
echo "$COUNTS" > "$OUT/COUNTS"
date -u +%Y-%m-%dT%H:%M:%SZ > "$OUT/CREATED_UTC"

mkdir -p "$BACKUP_DIR"
FINAL="$BACKUP_DIR/$NAME.tar.gz"
tar -C "$WORK" -czf "$FINAL" "$NAME"
tar -tzf "$FINAL" >/dev/null || fail "архив повреждён сразу после создания"

# The copy that LEAVES this server is encrypted for the developer's age key (the private key never
# lives here). The local archive stays readable: restoring after a bad update must not depend on that
# key — and this disk holds the live database anyway.
OUTSIDE=""
if [ -n "$AGE_RECIPIENT" ]; then
  command -v age >/dev/null 2>&1 || fail "для шифрования нужен age (sudo apt install age)"
  age -r "$AGE_RECIPIENT" -o "$FINAL.age" "$FINAL" || fail "архив создан ($FINAL), но зашифровать копию не удалось"
  OUTSIDE="$FINAL.age"
fi

# keep the newest KEEP archives (and KEEP encrypted copies) on this machine
# (no match at all is fine: «|| true», or pipefail + set -e would stop the script right here)
for pattern in 'pb_data-*.tar.gz' 'pb_data-*.tar.gz.age'; do
  # shellcheck disable=SC2086
  { ls -1t "$BACKUP_DIR"/$pattern 2>/dev/null || true; } | tail -n +"$((KEEP + 1))" | while IFS= read -r old; do rm -f -- "$old"; done
done

if [ -n "$UPLOAD_CMD" ]; then
  [ -n "$OUTSIDE" ] || fail "архив создан ($FINAL), но без PRIME_BACKUP_AGE_RECIPIENT наружу ничего не отправляется — копия ушла бы незашифрованной"
  sh -c "$UPLOAD_CMD" upload "$OUTSIDE" || fail "архив создан ($FINAL), но выгрузка во внешнее хранилище не удалась"
fi

echo "OK: $FINAL ($COUNTS)${OUTSIDE:+ · зашифрованная копия для внешнего хранения: $OUTSIDE}"
