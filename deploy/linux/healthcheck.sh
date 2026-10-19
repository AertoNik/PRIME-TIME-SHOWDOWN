#!/usr/bin/env bash
# PRIME TIME: SHOWDOWN — is the PRIME NETWORK API alive?   /opt/primetime/deploy/healthcheck.sh api.example.com
# Checks: the service, PocketBase on 127.0.0.1, the HTTPS address from outside, the registration
# mode, that the dashboard is NOT public, the last backup.
set -uo pipefail
DOMAIN="${1:-}"
ok() { printf '  OK    %s\n' "$*"; }
bad() { printf '  FAIL  %s\n' "$*"; FAILED=1; }
FAILED=0

systemctl is-active --quiet pocketbase && ok "служба pocketbase работает" || bad "служба pocketbase не работает (journalctl -u pocketbase -n 50)"
curl -fsS http://127.0.0.1:8090/api/health >/dev/null 2>&1 && ok "PocketBase отвечает на 127.0.0.1:8090" || bad "PocketBase не отвечает локально"
if [ -n "$DOMAIN" ]; then
  curl -fsS "https://$DOMAIN/api/health" >/dev/null 2>&1 && ok "https://$DOMAIN/api/health отвечает (сертификат действителен)" || bad "https://$DOMAIN не отвечает (DNS, порт 443, Caddy?)"
  MODE="$(curl -fsS "https://$DOMAIN/api/prime/config" 2>/dev/null | sed -n 's/.*"registration":"\([a-z_]*\)".*/\1/p')"
  [ -n "$MODE" ] && ok "режим регистрации: $MODE" || bad "не удалось прочитать /api/prime/config"
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN/_/")"
  [ "$CODE" = "404" ] && ok "панель администратора из интернета закрыта (404)" || bad "панель /_/ отвечает снаружи кодом $CODE — проверьте Caddyfile"
fi
LAST="$(ls -1t /var/backups/primetime/pb_data-*.tar.gz* 2>/dev/null | head -1)"
[ -n "$LAST" ] && ok "последняя копия: $LAST" || bad "резервных копий ещё нет (sudo systemctl start prime-backup)"
exit $FAILED
