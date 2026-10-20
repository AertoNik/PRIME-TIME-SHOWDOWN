#!/usr/bin/env bash
# PRIME TIME: SHOWDOWN — is the PRIME NETWORK API alive?   /opt/primetime/deploy/healthcheck.sh api.example.com
# Checks: the service, PocketBase on 127.0.0.1, the HTTPS address from outside, the registration
# mode, CORS, the 1.8.4 protection and documents, that the dashboard is NOT public, the last backup.
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
  # 1.8.3: one active game session per PRIME ID (PRIME_SESSIONS=off is the emergency switch back to 1.8.2)
  SESS="$(curl -fsS "https://$DOMAIN/api/prime/config" 2>/dev/null | sed -n 's/.*"sessions":\([0-9]\).*/\1/p')"
  case "$SESS" in
    1) ok "PRIME CLOUD 2.0: одна активная игровая сессия на PRIME ID включена" ;;
    0) printf '  INFO  %s\n' "PRIME CLOUD 2.0 выключен (PRIME_SESSIONS=off) — сохранения по правилам 1.8.2" ;;
    *) printf '  INFO  %s\n' "сервер ещё без PRIME CLOUD 2.0 (код до 1.8.3)" ;;
  esac
  # CORS: every page address in PRIME_ORIGINS must get its own Access-Control-Allow-Origin on a preflight
  ORIGINS="$(sed -n 's/^PRIME_ORIGINS=//p' /etc/primetime/pocketbase.env 2>/dev/null | tr -d '"' | tr ',' ' ')"
  [ -n "$ORIGINS" ] || bad "PRIME_ORIGINS не задан в /etc/primetime/pocketbase.env (игра не сможет обращаться к серверу)"
  for O in $ORIGINS; do
    ACAO="$(curl -s -o /dev/null -D - -X OPTIONS -H "Origin: $O" -H 'Access-Control-Request-Method: GET' "https://$DOMAIN/api/health" 2>/dev/null | tr -d '\r' | sed -n 's/^[Aa]ccess-[Cc]ontrol-[Aa]llow-[Oo]rigin: //p')"
    [ "$ACAO" = "$O" ] && ok "CORS: страница $O может обращаться к серверу" || bad "CORS: сервер не разрешает $O — проверьте PRIME_ORIGINS и перезапустите pocketbase"
  done
  # 1.8.4: public registration is protected (challenge, documents) and needs real email; the documents are online
  CFG="$(curl -fsS "https://$DOMAIN/api/prime/config" 2>/dev/null)"
  if echo "$CFG" | grep -q '"pow":1'; then
    ok "1.8.4: регистрация с проверкой (proof of work), документы v$(echo "$CFG" | sed -n 's/.*"terms":{"v":\([0-9]*\).*/\1/p'), удаление и выгрузка аккаунта"
    [ "$MODE" = "public" ] && echo "$CFG" | grep -q '"mail":true' && ok "публичная регистрация: письма подтверждения включены"
    GAME="$(echo "$CFG" | sed -n 's/.*"gameUrl":"\([^"]*\)".*/\1/p')"
    if [ -n "$GAME" ]; then
      for P in legal/ru/privacy.html legal/en/privacy.html legal/ru/terms.html; do
        C="$(curl -s -o /dev/null -w '%{http_code}' "${GAME%/}/$P")"
        [ "$C" = "200" ] && ok "документ ${GAME%/}/$P открывается" || bad "документ ${GAME%/}/$P не открывается ($C) — опубликована ли игра 1.8.4?"
      done
    fi
  else
    printf '  INFO  %s
' "сервер ещё без 1.8.4 (публичную регистрацию не включать)"
  fi
  [ -f /var/lib/primetime/prime-deletions.log ] && printf '  INFO  %s
' "журнал удалённых аккаунтов: $(wc -l < /var/lib/primetime/prime-deletions.log | tr -d ' ') за 60 дней (только id и дата)"
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN/_/")"
  [ "$CODE" = "404" ] && ok "панель администратора из интернета закрыта (404)" || bad "панель /_/ отвечает снаружи кодом $CODE — проверьте Caddyfile"
fi
LAST="$(ls -1t /var/backups/primetime/pb_data-*.tar.gz* 2>/dev/null | head -1)"
[ -n "$LAST" ] && ok "последняя копия: $LAST" || bad "резервных копий ещё нет (sudo systemctl start prime-backup)"
exit $FAILED
