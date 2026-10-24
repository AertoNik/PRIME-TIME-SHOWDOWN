# Robokassa для PRIME TIME: SHOWDOWN — настройка и первый тестовый платёж

> Для владельца. Работаем **по одному действию**: каждый шаг — что открыть, что проверить, что (если нужно) изменить, сохранять ли. Пароли Robokassa **никогда** не вставляйте в чат, в код, в README, в скриншоты и в документы — только в файл настроек сервера (шаг 6). Ничего из этого документа не выполнено: сервер, база и кабинет Robokassa не менялись.

Как устроена оплата и защита — `docs/PRIME_PAYMENTS.md`, `docs/PAYMENTS_SECURITY.md`.

## Что уже есть в коде (этап 4)

- Способ оплаты — **классическая платёжная страница Robokassa** (`https://auth.robokassa.ru/Merchant/Index.aspx`, POST-форма), подтверждение — **ResultURL**.
- Идентификатор магазина: **`primetimeshowdown`** (не секрет).
- Алгоритм подписи — из настройки сервера `ROBOKASSA_HASH_ALGORITHM`: **md5**, **sha256** или **sha512** (RIPEMD160, SHA1, SHA384 сервер не поддерживает). Без настройки оплаты нет — алгоритм никогда не угадывается.
- Маршруты сервера (реальные, реализованы и проверены на временной базе):

| Назначение | Адрес на сервере | Метод |
|---|---|---|
| ResultURL (уведомление об оплате) | `/api/prime/pay/robokassa/result` | **POST** (GET тоже принимается) |
| SuccessURL (возврат после оплаты) | `/api/prime/pay/robokassa/success` | **GET** (POST тоже принимается) |
| FailURL (возврат без оплаты) | `/api/prime/pay/robokassa/fail` | **GET** (POST тоже принимается) |

SuccessURL и FailURL на сервере ничего не решают: они только возвращают игрока в игру (`PRIME_GAME_URL` этого сервера), а игра спрашивает сервер о заказе.

## Важно про адреса: тест идёт на отдельный сервер

Тестовые платежи должны приходить на **тестовый сервер (staging)** с отдельной базой — не на production. Production тестовые уведомления отклоняет (у него нет тестовых паролей, и он не учитывает тестовые права), поэтому тест на production просто не пройдёт.

По документации Robokassa адреса ResultURL / SuccessURL / FailURL задаются в технических настройках магазина один раз — отдельных адресов для тестового режима в документации нет (проверьте в кабинете, шаг 1). Значит, **на время тестов** адреса указывают на staging, а **перед боевым запуском** — на production:

| | ResultURL | SuccessURL | FailURL |
|---|---|---|---|
| **Тест (staging)** | `https://<staging-домен>/api/prime/pay/robokassa/result` | `https://<staging-домен>/api/prime/pay/robokassa/success` | `https://<staging-домен>/api/prime/pay/robokassa/fail` |
| **Production (после разрешения)** | `https://api.primetimeshowdown.online/api/prime/pay/robokassa/result` | `https://api.primetimeshowdown.online/api/prime/pay/robokassa/success` | `https://api.primetimeshowdown.online/api/prime/pay/robokassa/fail` |

**1.8.8 final — одни адреса для всего.** После выкладки 1.8.8 на production адреса кабинета можно один раз направить на production: production сам передаёт уведомления и возвраты по тестовым счетам staging (`PRIME_PAY_RELAY_URL=http://127.0.0.1:8091`), а демонстрационные и будущие боевые обрабатывает сам. Подробно — `docs/PRIME_DEMO.md`, раздел 3.

`<staging-домен>` ещё не выбран (например, второе имя DuckDNS, указывающее на тот же VPS). Пока его нет, адреса в кабинете не меняем. Production-адреса заработают только после выкладки сервера 1.8.8 (сейчас на сервере 1.8.4 — этих маршрутов там нет).

---

## Шаг 1. Только посмотреть (ничего не менять и не сохранять)

Личный кабинет Robokassa → магазин **primetimeshowdown** → **Технические настройки**. Запишите себе (без паролей):

1. Идентификатор магазина — `primetimeshowdown`?
2. **Алгоритм расчёта хеша** основного блока (по вашему скриншоту — MD5).
3. Блок **тестовых параметров**: какой алгоритм выбран (по скриншоту — не выбран), заданы ли тестовые пароль #1 и #2.
4. Что стоит в полях Result URL, Success URL, Fail URL и **методы** отправки (GET/POST) для каждого.
5. Есть ли отдельные поля адресов для тестового режима (по документации — нет).
6. Раздел **«Фискализация»**: подключены ли «Робочеки СМЗ» (для чеков НПД, см. шаг 12).

Если вы уже выбрали SHA256 в тестовом блоке, но не сохранили — **не сохраняйте пока**; сначала шаг 2.

## Шаг 2. Решить про алгоритм (одно решение для обоих блоков)

Документация Robokassa требует, чтобы алгоритм тестового блока **совпадал с рабочим**. Варианты:

- **SHA256 (рекомендуется)** — надёжнее MD5. Тогда в основном блоке тоже SHA256 (магазин пока нигде не подключён, других интеграций, которые сломались бы, нет).
- **MD5** — уже стоит в основном блоке; тогда в тестовом тоже MD5.

Код поддерживает оба. Главное — то, что сохранено в кабинете, должно совпадать с `ROBOKASSA_HASH_ALGORITHM` на сервере. Если не совпадёт, оплата просто не пройдёт (Robokassa покажет ошибку подписи; сервер запишет в журнал подсказку `algorithm:…`).

## Шаг 3. Тестовые пароли

В блоке тестовых параметров задайте (или сгенерируйте) **тестовый пароль #1** и **тестовый пароль #2**:
- разные между собой;
- не совпадают с боевыми паролями;
- не короче 8 символов (сервер с короткими не включит оплату);
- храните их только в менеджере паролей. В чат, код и документы — нет.

## Шаг 4. Одно сохранение технических настроек (когда staging-домен уже есть)

Проверьте **все** поля вместе и только потом нажмите «Сохранить» один раз:

| Поле | Значение |
|---|---|
| Алгоритм (основной и тестовый) | выбранный на шаге 2, одинаковый |
| Тестовые пароли #1, #2 | заданы (шаг 3) |
| Result URL | `https://<staging-домен>/api/prime/pay/robokassa/result` |
| Метод Result URL | **POST** |
| Success URL | `https://<staging-домен>/api/prime/pay/robokassa/success` |
| Метод Success URL | **GET** |
| Fail URL | `https://<staging-домен>/api/prime/pay/robokassa/fail` |
| Метод Fail URL | **GET** |

Ничего не отправляйте на модерацию и не включайте магазин — это не нужно для тестового режима (если кабинет требует иного — остановитесь и напишите, что он показывает).

## Шаг 5. Тестовый сервер (staging) — нужно отдельное разрешение на установку

Шаблоны: `deploy/linux/staging/pocketbase-staging.service`, `deploy/linux/staging/staging.env.example`, `deploy/linux/staging/Caddyfile.staging`, `deploy/linux/robokassa.env.example`. Своя копия программы (`/opt/primetime-staging`), своя база (`/var/lib/primetime-staging`), свои настройки (`/etc/primetime-staging/`), свой порт (8091) — production не затрагивается. В базе staging — только выдуманные тестовые PRIME ID.

Порядок (по разрешению, отдельной сессией): DNS-имя → Caddy-блок → копия программы и hooks из архива 1.8.8 → `staging.env` (`PRIME_SERVER_ROLE=staging`, `PRIME_PAY_MODE=off`, `PRIME_SHOP_SALES=open`, свой `PB_ENCRYPTION_KEY`) → служба → суперпользователь staging → тестовый PRIME ID (подтверждённый, документы приняты).

Игра для теста: тестовая сборка, которая ходит в staging-API (`VITE_PRIME_ACCOUNTS=beta`, `VITE_PRIME_API_URL=https://<staging-домен>`), например `npm run build` + `npm run preview` на вашем компьютере (`http://localhost:4173`). На staging: `PRIME_GAME_URL=http://localhost:4173/`, `PRIME_ORIGINS=http://localhost:4173`. Формат `PRIME_GAME_URL` (1.8.8): `https://…` — любой адрес, `http://` — только `localhost` / `127.0.0.1`; `/` в конце сервер добавит сам. Неверный адрес → после оплаты страница «Проверяем оплату» с подсказкой вместо игры (в журнале при старте — `PRIME WARNING: PRIME_GAME_URL is INVALID`; `prime-shop status` показывает адрес). Публичный сайт для теста не нужен и не меняется.

## Шаг 6. Тестовые секреты на staging (только на сервере)

Файл секретов staging — из шаблона, только root и группа pocketbase могут его читать. В нём заполните `ROBOKASSA_HASH_ALGORITHM=` (шаг 2), `ROBOKASSA_TEST_PASSWORD_1=`, `ROBOKASSA_TEST_PASSWORD_2=`. **Боевые пароли сюда не пишите** — сервер с ними откажется включать тест.

```bash
sudo install -m 640 -o root -g pocketbase deploy/linux/robokassa.env.example /etc/primetime-staging/robokassa.env
```

```bash
sudo nano /etc/primetime-staging/robokassa.env
```

Затем в настройках staging поставьте `PRIME_PAY_MODE=test` и перезапустите **только** staging-службу:

```bash
sudo nano /etc/primetime-staging/pocketbase.env
```

```bash
sudo systemctl restart pocketbase-staging
```

## Шаг 7. Проверить настройку staging

```bash
sudo journalctl -u pocketbase-staging -n 30 --no-pager
```

```bash
sudo PRIME_INSTANCE=staging bash deploy/linux/prime-shop.sh status
```

Ожидается строка `PRIME: server role staging, payments test (Robokassa, sha256)` (или md5) и в `status`: `ready: true`, `env: test`, `counted: test`, `gateway: robokassa`. Если `ready: false` — `problem:` скажет причину (`passwords_missing`, `algorithm_missing`, `live_secrets_on_test_server`…). Паролей команда не печатает. `prime-shop selftest` печатает эталонные подписи на выдуманных паролях — они должны совпасть с `npm run payments` (проверено локально).

## Шаг 8. Первый тестовый платёж

1. Откройте тестовую сборку игры, войдите тестовым PRIME ID.
2. PRIME SHOP → любой предмет → кнопка покупки. В окне: **«Тестовый платёж»**, цена **10 ₽ · тестовый платёж**, «Тестовые условия оплаты PRIME SHOP».
3. Отметьте «Я понимаю, что это тестовая оплата Robokassa…» → **«Перейти к оплате · 10 ₽»**.
4. Откроется страница Robokassa (тестовая). Если вместо неё ошибка подписи (например, код 29) — алгоритм или тестовый пароль #1 не совпадают с кабинетом: остановитесь, проверьте шаги 2–6.
5. Проведите тестовую оплату (тестовый способ на странице Robokassa).
6. Вы вернётесь в игру: после заставки — «Проверяем подтверждение оплаты…», затем **«ПОКУПКА ПОДТВЕРЖДЕНА · ДОБРО ПОЖАЛОВАТЬ В PRIME COLLECTION»**.

## Шаг 9. Проверить заказ и предмет

```bash
sudo PRIME_INSTANCE=staging bash deploy/linux/prime-shop.sh orders 5
```

```bash
sudo PRIME_INSTANCE=staging bash deploy/linux/prime-shop.sh order <InvId>
```

`<InvId>` — номер из списка `orders 5`. С 1.8.8 (доработка 23.10.2026) тестовые номера — от `500 000 000 000 000` (+10 в секунду с 01.01.2026); заказы, созданные раньше по старой схеме (`900 000 001…`), остаются как были. Ожидается: `<InvId>  test  fulfilled  <sku>  10.00 RUB  <id ник>`; в журнале `order_created`, `paid result`, `fulfilled`; `right: <sku> active`. В игре: «Моя коллекция» → «Облики бойцов» (скин) или эффект — **приобретён**, надевается; после перезагрузки и после входа в браузере-«втором устройстве» — тоже.

## Шаг 9А. Возврат в игру и вторая вкладка (1.8.8)

1. После тестовой оплаты Robokassa возвращает в игру (не белая страница): на заставке — «PRIME SHOP · заказ №N: нажмите, чтобы проверить покупку», затем экран заказа.
2. Если страница оплаты не открылась — в окне заказа «Открыть в новой вкладке»: оплата идёт в новой вкладке (тот же счёт). Вернитесь в первую вкладку — она сама проверит заказ (и сразу, если вторая вкладка игры уже показала «ПОКУПКА ПОДТВЕРЖДЕНА»).
3. Страница возврата при неверном адресе: временно поставьте на staging неверный `PRIME_GAME_URL` (например, `http://192.168.0.10:4173`), перезапустите **только** staging и откройте `https://<staging-домен>/api/prime/pay/robokassa/success?InvId=1` — должна быть страница «Проверяем оплату» (без кнопки, с подсказкой). Верните адрес и перезапустите staging.
4. Без входа в игру и без ResultURL открытие SuccessURL **ничего не выдаёт** (заказ остаётся `pending_payment`).

## Шаг 10. Неуспешная операция

Повторите покупку другого предмета и на странице Robokassa **откажитесь от оплаты**. Ожидается: в игре «Оплата не завершена», предмет не выдан, заказ в `prime-shop orders` — `pending_payment` (через 2 ч 15 мин — `expired`). «Повторить оплату» открывает **тот же** счёт.

## Шаг 11. Что деньги не списаны и где журналы

- Тестовый режим Robokassa ничего не списывает; тестовые операции не показываются в поиске операций кабинета (документация testing-mode). Карта для теста не нужна — используйте тестовый способ оплаты.
- Журнал службы: `sudo journalctl -u pocketbase-staging -n 100 --no-pager`.
- Журнал запросов и предупреждений PocketBase (в т. ч. `prime-pay: notification refused` с причиной и подсказкой) — в панели администратора staging («Logs») через SSH-туннель, как для production (`docs/PRIME_CLOUD_DEPLOY.md`, «Панель администратора»); туннель staging — на другой локальный порт, не 18090.
- Пароли, подписи и email плательщика в журналы не пишутся.

## Шаг 11А. Учения: восстановление старой копии на staging (1.8.8)

Только на staging (отдельная база, тестовые PRIME ID). Проверяет, что номера счетов не повторяются и оплаты не теряются.

1. Копия staging:
```bash
sudo PRIME_DATA_DIR=/var/lib/primetime-staging/pb_data PRIME_BACKUP_DIR=/var/backups/primetime-staging bash deploy/linux/backup.sh
```
2. После копии: одна тестовая оплата (шаг 8) и один заказ, оставленный без оплаты (запишите оба номера из `orders 5`).
3. Восстановить копию (остановит и запустит **только** staging):
```bash
sudo PRIME_DATA_DIR=/var/lib/primetime-staging/pb_data PRIME_SERVICE=pocketbase-staging PRIME_ENV_FILE=/etc/primetime-staging/pocketbase.env PRIME_HEALTH_URL=http://127.0.0.1:8091/api/health bash deploy/linux/restore.sh /var/backups/primetime-staging/<архив>.tar.gz
```
4. Журнал: `sudo journalctl -u pocketbase-staging -n 30 --no-pager` — строка `PRIME: invoice ledger re-applied — orders rebuilt 1, delivered 1…`; `sudo PRIME_INSTANCE=staging bash deploy/linux/prime-shop.sh ledger` — «paid but missing in the database: 0».
5. Оплаченный после копии предмет — снова в «Моей коллекции»; новый заказ получает номер **больше** всех прежних.
6. Отложенную копию данных (`…pb_data.before-restore-…`) удалить, когда всё проверено (в ней тестовые аккаунты).

## Шаг 12. Перед production — чек-лист (каждый пункт — решение владельца)

1. Магазин прошёл модерацию Robokassa и активирован.
2. Цены семи товаров утверждены (`SHOP_PRICE_STATUS = 'approved'`, `docs/PRIME_PRICES.md`), `SHOP_SALES_OPEN = true` в релизе.
3. Оферта утверждена и опубликована (`public/legal/ru/offer.html`, `SHOP_OFFERS`, `docs/PRIME_CHECKOUT.md` §5); обновлены Соглашение и Политика (п. 1.3).
4. Чеки НПД: «Робочеки СМЗ» подключены, разрешение в «Мой налог» выдано; ясно, откуда берётся название в чеке и как аннулировать чек при возврате (`docs/NPD_RECEIPTS.md`).
5. Сервер 1.8.8 выложен на production с выключенной оплатой и проверен (`docs/PRIME_PAYMENTS.md` §12); свежая копия проверена (`backup-check.sh`), зашифрованная копия есть **вне VPS**; учения шага 11А на staging пройдены.
6. Адреса в кабинете переключены на production (таблица выше), метод Result URL — POST.
7. `/etc/primetime/robokassa.env`: `ROBOKASSA_HASH_ALGORITHM`, `ROBOKASSA_PASSWORD_1`, `ROBOKASSA_PASSWORD_2` (+ `_3` и `PRIME_PAY_REFUND_API=on`, если подключён API возвратов); **тестовых паролей там быть не должно**. Служба с `EnvironmentFile=-/etc/primetime/robokassa.env`.
8. `/etc/primetime/pocketbase.env`: `PRIME_SERVER_ROLE=production`, `PRIME_PAY_MODE=live`, `PRIME_SHOP_SALES=open`.
9. Контрольная покупка владельцем на минимальную сумму, проверка чека, при необходимости возврат через кабинет и `sudo bash deploy/linux/prime-shop.sh refund <InvId> reason="…"`, затем `… refund-done <InvId>`.

Команды выполняются из распакованного архива сервера (`deploy/linux/prime-shop.sh` загружает настройки сервера и ключ шифрования, как `invites.sh`; паролей не печатает).
