# Свой домен игры и CORS — primetimeshowdown.online

> Ничего на сервере не изменено. Шаги ниже выполняете вы, когда решите.

Адреса:

- игра — https://primetimeshowdown.online (GitHub Pages; старый адрес `aertonik.github.io/PRIME-TIME-SHOWDOWN` теперь перенаправляет сюда);
- сервер — https://primetime-showdown-beta.duckdns.org.

Команды с `$` в начале выполняются **на сервере** по SSH, без самого `$`. Остальные — на Mac.

## 1. Причина ошибки

Браузер пускает игру к серверу другого домена, только если сервер явно разрешает её адрес. Разрешает **PocketBase**: Caddy CORS не трогает, а игра проверок по домену не делает.

PocketBase берёт список адресов из строки `PRIME_ORIGINS` в файле `/etc/primetime/pocketbase.env`. Служба передаёт её флагу `--origins`, см. `deploy/linux/pocketbase.service`. Сейчас там только `https://aertonik.github.io`.

Проверено с Mac обычными запросами к серверу, ничего не меняя:

| Origin | Ответ на предварительный запрос (preflight) |
|---|---|
| `https://aertonik.github.io` | `access-control-allow-origin: https://aertonik.github.io` |
| `https://primetimeshowdown.online` | `204`, **без** `access-control-allow-origin` → браузер блокирует |

Поэтому PRIME NETWORK на новом домене пишет «сервер недоступен», хотя сервер работает.

## 2. Что изменить — только две строки на сервере

Код игры и сервера менять не нужно, обновление сервера (`update.sh`) тоже не требуется.

1. Сделайте копию настроек. Именно `cp -p`: в файле секреты, и копия должна остаться с теми же правами, что и оригинал (только root и pocketbase):

   ```bash
   $ sudo cp -p /etc/primetime/pocketbase.env /etc/primetime/pocketbase.env.before-domain
   ```

2. Откройте файл настроек:

   ```bash
   $ sudo nano /etc/primetime/pocketbase.env
   ```

3. Приведите две строки к такому виду:

   ```
   PRIME_ORIGINS=https://primetimeshowdown.online,https://aertonik.github.io
   PRIME_GAME_URL=https://primetimeshowdown.online/
   ```

   - **Через запятую и без пробелов**, без `/` в конце, без пути. Не `*` и не `http://`.
   - Старый адрес остаётся: он ничего не ослабляет и выручит, если у кого-то ещё открыта старая страница.
   - `PRIME_GAME_URL` — только кнопка «вернуться в игру» на страницах писем. Её можно и не менять.

   Сохраните: Ctrl+O, Enter, Ctrl+X.

4. Проверьте, что получилось:

   ```bash
   $ sudo grep -E '^PRIME_(ORIGINS|GAME_URL)=' /etc/primetime/pocketbase.env
   ```

5. Перезапустите PocketBase:

   ```bash
   $ sudo systemctl restart pocketbase
   $ systemctl is-active pocketbase
   ```

   Должно быть `active`.

Перезапуск занимает несколько секунд. Аккаунты, сессии и сохранения в базе не меняются. У игроков на эти секунды может мелькнуть «нет соединения», потом всё продолжится само.

## 3. Проверки после изменения

С Mac:

```bash
curl -s -o /dev/null -D - -X OPTIONS -H "Origin: https://primetimeshowdown.online" -H "Access-Control-Request-Method: GET" https://primetime-showdown-beta.duckdns.org/api/health | grep -i access-control-allow-origin
```

Ожидается `access-control-allow-origin: https://primetimeshowdown.online`.

Запрос с авторизацией (так игра сохраняет прогресс):

```bash
curl -s -o /dev/null -D - -X OPTIONS -H "Origin: https://primetimeshowdown.online" -H "Access-Control-Request-Method: PUT" -H "Access-Control-Request-Headers: authorization,content-type" https://primetime-showdown-beta.duckdns.org/api/prime/save | grep -i access-control-allow
```

Ожидаются строки с `allow-origin: https://primetimeshowdown.online` и `allow-headers: authorization,content-type`.

Чужие адреса по-прежнему не пускаются — команда должна вывести **пустоту**:

```bash
curl -s -o /dev/null -D - -X OPTIONS -H "Origin: https://example.com" -H "Access-Control-Request-Method: GET" https://primetime-showdown-beta.duckdns.org/api/health | grep -i access-control-allow-origin
```

В браузере откройте https://primetimeshowdown.online → PRIME ID. Блок PRIME NETWORK должен показать CLOSED BETA и вход, а не «сервер недоступен». Войдите, сыграйте матч и дождитесь «PRIME CLOUD · СИНХРОНИЗИРОВАНО». В консоли Chrome не должно быть ошибок CORS.

После следующего обновления сервера `healthcheck.sh` будет сам проверять каждый адрес из `PRIME_ORIGINS`: строки «CORS: страница … может обращаться к серверу». Эта проверка уже есть в проекте, на сервер она попадёт с ближайшим `update.sh`.

## 4. Обязательно: HTTPS на GitHub Pages

Сейчас сайт отвечает и по `http://primetimeshowdown.online`. Старый адрес перенаправляет именно туда, на `http`.

- Страница по `http` — это **другой** адрес для браузера. Сервер её правильно не пускает, а прогресс гостя там хранится отдельно от `https`-версии.
- Включите HTTPS: GitHub → репозиторий → **Settings → Pages → Enforce HTTPS**.
- Если галочка неактивна, GitHub ещё выпускает сертификат для домена. Обычно это занимает от нескольких минут до суток после настройки DNS.
- После включения все запросы будут уходить на `https://primetimeshowdown.online`.

Добавлять `http://primetimeshowdown.online` в `PRIME_ORIGINS` **не нужно и небезопасно**: страницу без шифрования можно подменить по дороге.

## 5. Что заметят игроки

- **Аккаунты PRIME ID:** на новом домене нужно один раз войти заново. Браузер хранит вход отдельно для каждого адреса. Прогресс загрузится сам из PRIME CLOUD.
- **Гостевой прогресс** (без аккаунта) хранится в браузере под **старым** адресом. Старый адрес теперь перенаправляет на новый, поэтому на новом домене гость начнёт с нуля. Его прежние данные не удалены, но через новый адрес их не видно. Если это важно для кого-то из тестировщиков, решение за вами.

## 6. Откат

```bash
$ sudo cp -p /etc/primetime/pocketbase.env.before-domain /etc/primetime/pocketbase.env
$ sudo systemctl restart pocketbase
```

Сервер снова будет пускать только старый адрес. Данные это не затрагивает.
