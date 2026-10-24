# Alpha 1.8.8 — план выпуска (staging → production → GitHub Pages)

> Подготовлено 23.10.2026, обновлено 24.10.2026. **Состояние (по сообщению владельца, 24.10.2026):** staging обновлён до 1.8.8 и проверен (этап А, пункты 2–5: настоящая демо-покупка через тестовую страницу Robokassa — заказ 700000255642560, `demo`, `fulfilled`, RAY 99 ₽; staging возвращён в `PRIME_PAY_MODE=test`, все 5 заказов на месте). **Юридические документы утверждены владельцем и установлены локально 24.10.2026 (этап Д выполнен локально, на сайте их ещё нет).** **Production, сайт и кабинет Robokassa не менялись.** Каждый следующий этап — только по отдельному решению владельца. Команды с `$` выполняются на VPS по SSH (без самого `$`), остальные — на Mac в `~/Desktop/PRIME TIME Duel`.

## 0. Что выпускается и что остаётся выключенным

Включается: PRIME SHOP (каталог, примерка, гардероб), PRIME CHECKOUT, серверные заказы и права, журнал счетов, возврат после оплаты без белой страницы, утверждённые цены шести предметов, сервер на `api.primetimeshowdown.online`.

Остаётся выключенным: **настоящие списания** (нет `PRIME_PAY_MODE=live`, `SHOP_SALES_OPEN = false`, нет боевых паролей), **демонстрационная оплата** (до этапа Г), **публикация юридических документов** (до этапа Д).

Порядок: **Д (документы) → А (staging) → Б (сервер production) → В (сайт) → Г (демонстрация) → модерация Robokassa → Е (настоящие продажи, позже).** Сервер — раньше сайта: сервер 1.8.8 принимает сохранения игры 1.8.4, а игра 1.8.8 рассчитана на сервер 1.8.8. Документы: после этапа Б сервер считает действующими Соглашение и Политику ред. 3, а сайт до этапа В показывает ред. 2 — поэтому В выполнять сразу после Б (регистрация на production сейчас по приглашениям, окно расхождения — минуты).

Архив сервера (24.10.2026, после утверждения документов): `server-bundle/prime-server-1.8.8-alpha.tar.gz`, SHA-256 `9c2f0b1b91cb7f730c6b9f1f8cfa2b042021c398811ff7872ac677ae7352cb4e` (+ `.sha256`). От предыдущего отличается только двумя файлами: `lib/shop_rules.js` (оферта ред. 1, SHA-256 `2a6de21c…4625`, действует с 24.10.2026) и `lib/legal.js` (Соглашение и Политика ред. 3, повторное принятие не требуется). **Архив `…previous-cf38178a.tar.gz` (загружен на VPS и установлен на staging) финальным не считать** — на staging и production ставить новый. Прежние архивы 1.8.8 сохранены: `…previous-27b8a6e2.tar.gz` (23.10, 22:56 — со старым `chown -R root:root` в `update.sh`, **не использовать для production**) и `…previous-2d66d2d0.tar.gz` (23.10, 14:20); их `.sha256` хранят прежнее имя файла. Архив 1.8.4 не тронут.

## Д. Юридические документы (до публикации сайта)

**Выполнено локально 24.10.2026:** решения владельца — в `decisions.json` (все «approved»), `npm run legal:release -- --approved --date=2026-10-24`, SHA-256 оферты в `src/config/offer.config.ts`, `legal.js` (terms 3 / privacy 3, `reaccept` Соглашения оставлен 2 — действующих игроков не останавливает), EN-переводы ред. 3, `backend:rules`, все проверки, `build`, новый архив. **Если сайт выйдет не 24.10.2026** — до публикации повторить шаги 3–4 с новой датой (изменятся SHA-256 оферты и архив).

1. Прочитать предпросмотр: `npm run legal:release` → `docs/legal-drafts/site-preview/ru/*.html` (приватно). Список решений и недостающих данных — `docs/legal-drafts/README.md`.
2. Решения владельца от 24.10.2026 уже записаны в `docs/legal-drafts/seller.json`: ФИО и ИНН публикуются, контакт — только электронная почта, телефон и город не публикуются (риск модерации Robokassa из-за отсутствия телефона — `docs/legal-drafts/PRIME_SHOP_OFFER_REVIEW.md`, часть 3.2). Условия Р-3…Р-10 и Р-12 утверждены 24.10.2026 (`docs/legal-drafts/decisions.json`).
3. Утвердить тексты (с юристом), затем: `npm run legal:release -- --approved --date=ГГГГ-ММ-ДД` — страницы встанут в `public/legal/ru/`, появится строка продавца в игре. Команда напечатает строку для `src/config/offer.config.ts` (SHA-256 оферты) и шаги для `backend/pb_hooks/lib/legal.js` (версии Соглашения и Политики) и EN-переводов.
4. `npm run backend:rules && npm run public:test && npm run checkout && npm run build` — затем новый архив сервера (`npm run server:bundle -- --replace`), потому что правила сервера (редакция оферты) изменились.

## А. Staging (отдельная база, тестовые аккаунты)

1. Загрузить архив на VPS (как в `docs/PRIME_CLOUD_DEPLOY.md`), распаковать в отдельную папку, сверить SHA-256 с `server-bundle/prime-server-1.8.8-alpha.tar.gz.sha256`.
2. Обновить **только** staging (копия staging делается сама, production не трогается):
   ```
   $ sudo PRIME_INSTANCE=staging bash deploy/linux/update.sh
   ```
   Права (исправлено 23–24.10.2026): `update.sh` больше не делает `chown -R root:root` папки приложения — файлы принадлежат root, группа `pocketbase` читает их (папка и программа — 750, hooks/migrations/public — `root:pocketbase`, `g+rX`). Перед любым изменением скрипт проверяет пользователя `pocketbase`, программу, папки и службу; неудачный перезапуск ведёт к возврату прежних файлов. Так же теперь делает и `install.sh`.
3. Проверки:
   ```
   $ sudo journalctl -u pocketbase-staging -n 40 --no-pager
   $ sudo PRIME_INSTANCE=staging bash deploy/linux/prime-shop.sh status
   $ sudo PRIME_INSTANCE=staging bash deploy/linux/prime-shop.sh ledger
   ```
   Ожидается: `payments test (Robokassa, sha256)`, `ledger: ok`, прежние 4 заказа на месте.
4. Тестовая покупка на настоящей тестовой странице Robokassa (`docs/ROBOKASSA_SETUP.md`, шаги 8–9А): каталог показывает **цену товара** (99 ₽) и «Тестовая оплата 10 ₽ · деньги не списываются»; новый счёт — от 500 000 000 000 000.
5. Репетиция демонстрации на staging (`docs/PRIME_DEMO.md`, раздел 6): 99 ₽ на тестовой странице, счёт от 700 000 000 000 000, «Тестовая покупка подтверждена», пометка «Тестовая покупка» в коллекции. Затем staging обратно в `PRIME_PAY_MODE=test`.
6. Учения восстановления (`docs/ROBOKASSA_SETUP.md`, шаг 11А).
7. **Проверка передачи** (после этапа Б, когда адреса кабинета переключены на production): тестовая покупка на staging проходит через production (`journalctl -u pocketbase` → `a test-range notification passed on to staging`).

## Б. Сервер production (без включения оплаты)

Репетиция на Mac — `npm run upgrade:test`: база, созданная кодом 1.8.4 (архив `prime-server-1.8.4-alpha.tar.gz`), запускается кодом 1.8.8 — миграции применяются, аккаунты, хеши паролей, профили, согласия и сохранения не меняются ни на байт, вход и PRIME CLOUD работают, оплата выключена; затем код 1.8.4 снова запускается на обновлённой базе (откат) — тоже работает.

1. Копия и её проверка:
   ```
   $ sudo systemctl start prime-backup
   $ sudo journalctl -u prime-backup -n 5 --no-pager
   ```
   Скачать свежий архив на Mac вне папки проекта и проверить `shasum -a 256 -c SHA256SUMS` (`docs/PRIME_CLOUD_BACKUP.md`, раздел 3). Сохранить копию `/etc/primetime/pocketbase.env` в менеджере паролей. **Зашифрованные копии вне VPS пока не настроены** — настроить (`PRIME_BACKUP_AGE_RECIPIENT`, `PRIME_BACKUP_UPLOAD_CMD`) до настоящих продаж.
2. Запомнить числа: `sudo sqlite3 "file:/var/lib/primetime/pb_data/data.db?mode=ro" "select count(*) from users; select count(*) from saves;"`.
3. Обновление (сам делает копию, считает аккаунты и сохранения до и после, при неудачном старте возвращает прежние файлы):
   ```
   $ sudo bash deploy/linux/update.sh
   ```
4. Проверки:
   ```
   $ sudo journalctl -u pocketbase -n 40 --no-pager
   $ sudo bash /opt/primetime/deploy/prime-shop.sh status
   $ sudo bash /opt/primetime/deploy/backup-check.sh
   $ sudo /opt/primetime/deploy/healthcheck.sh api.primetimeshowdown.online
   ```
   Ожидается: `server role production, payments off`, `invoice ledger ok`, `game address https://primetimeshowdown.online/`; число аккаунтов и сохранений не уменьшилось. `backup-check.sh` честно ответит «проблема», пока нет копий вне VPS.
5. В игре 1.8.4 (сайт ещё прежний): вход в PRIME ID, синхронизация PRIME CLOUD — работают как раньше.

**Откат этапа Б.** Неудачный старт — `update.sh` сам вернёт прежние файлы (`*.previous`). Откат вручную при работающем сервере: вернуть `/opt/primetime/pb_hooks.previous`, `pb_migrations.previous`, `pb_public.previous` на место и `sudo systemctl restart pocketbase`; новые таблицы магазина остаются в базе и прежней версии не мешают. Восстановление базы — только если она действительно испорчена: `sudo /opt/primetime/deploy/restore.sh <архив из шага 3>` (журнал счетов не откатывается, удалённые аккаунты удалятся снова). Аккаунты, созданные после копии, при восстановлении базы не вернутся — поэтому база восстанавливается только по необходимости.

## В. Сайт (GitHub Pages)

1. На Mac: `npm run build` и проверки (раздел «Проверки» ниже). `.env.beta` уже указывает на `https://api.primetimeshowdown.online` — сборка сайта не обратится к staging.
2. Пробный перенос (ничего не меняет):
   ```bash
   npm run publish:sync -- "/Users/user/Desktop/PRIME TIME SHOWDOWN"
   ```
3. Перенос (копирует исходники, никогда не удаляет, не копирует базы, архивы, `.env`, `docs/legal-drafts/`; пишет `.env.production`):
   ```bash
   npm run publish:sync -- "/Users/user/Desktop/PRIME TIME SHOWDOWN" --apply
   ```
4. VS Code → папка «PRIME TIME SHOWDOWN» → Source Control: просмотреть изменения (в `.env.production` — `api.primetimeshowdown.online`), один коммит «Alpha 1.8.8», **Sync** — это и есть публикация (GitHub Actions соберёт `npm run build` и выложит `dist`).
5. Проверка сайта: https://primetimeshowdown.online — «ALPHA 1.8.8» на заставке, вход в PRIME ID, PRIME SHOP с ценами и «ПОКА НЕ В ПРОДАЖЕ». Service worker в игре нет — после публикации достаточно обновить страницу (index.html GitHub Pages кеширует до ~10 минут).

**Откат этапа В:** в папке публикации `git revert HEAD` и Sync (точка отката — коммит `afa1ff5 Alpha 1.8.4`). Сервер 1.8.8 продолжает обслуживать игру 1.8.4.

## Г. Демонстрационная оплата (после В, по решению владельца)

`docs/PRIME_DEMO.md`, раздел 4: тестовые пароли в `/etc/primetime/robokassa.env` (без боевых), описание службы с `EnvironmentFile=-/etc/primetime/robokassa.env` (если ещё не установлено: `sudo install -m 644 deploy/linux/pocketbase.service /etc/systemd/system/pocketbase.service && sudo systemctl daemon-reload`), `PRIME_PAY_MODE=demo`, `PRIME_DEMO_UNTIL`, `PRIME_SHOP_SALES=open`, `PRIME_PAY_RELAY_URL=http://127.0.0.1:8091`, перезапуск. Кабинет Robokassa: Result/Success/Fail → `https://api.primetimeshowdown.online/api/prime/pay/robokassa/{result,success,fail}` (Result — POST). Сразу после — контрольная демо-покупка владельцем и тестовая покупка на staging (через передачу).

Конец демонстрации: `PRIME_DEMO_UNTIL` (само) или `PRIME_PAY_MODE=` + перезапуск + `prime-shop demo-end`.

## Е. Настоящие продажи (не сейчас)

Только после: одобрения магазина Robokassa; опубликованных документов; подключённых и проверенных «Робочеков СМЗ» (`docs/NPD_RECEIPTS.md`); копий вне VPS; решения по размещению базы (раздел «Блокеры» в `docs/legal-drafts/README.md`). Затем: убрать тестовые пароли, `prime-shop demo-end`, боевые пароли, `PRIME_PAY_MODE=live`, `SHOP_SALES_OPEN = true` в релизе (новая сборка и публикация), контрольная покупка владельцем и проверка чека.

## Проверки перед любым этапом (на Mac)

```bash
npm run backend:rules
```

```bash
npm run build
```

```bash
npm run payments
```

И остальные наборы: `checkout`, `shop`, `collection`, `primeid`, `accounts`, `tutorial`, `saves`, `events`, `lucien`, `modes`, `anims`, `cards`, `arenas`, `graveyard`, `music`, `sim`, `backend:test`, `public:test`, `beta:test`, `cloud:test`.
