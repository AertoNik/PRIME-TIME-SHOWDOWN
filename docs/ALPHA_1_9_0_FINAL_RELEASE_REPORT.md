# Alpha 1.9.0 — отчёт о финальном выпуске (30.10.2026)

> **FULL RELEASE SUCCESS.** Alpha 1.9.0 опубликована (сервер PRODUCTION + сайт), PRIME LEAGUE включена. До **понедельника 02.11.2026 00:00 МСК** идёт предсезонье, затем стартует сезон 1. Реальные iPhone и Android владелец проверяет сам после выпуска.

## 1. Сводка

| Раздел | Факт |
|---|---|
| **FINAL STATUS** | **FULL RELEASE SUCCESS** |
| **HOTFIX** | 1. CHALLENGE +40 вне дневного лимита. 2. Отдельный лимит лиги (IP + аккаунт, `Retry-After`). 3. Переключатель «Защита в эфире». Попутно: перезапрос профиля после 429. `league` 136/136, регресс 22 наборов — OK |
| **STAGING** | **HOTFIX PASS** (отчёт STAGING, раздел 10); SHA-256 `2cef325e7099ffa0b5e345efe90fef5dc86b1c5b75eea373176320b50040961e`; env восстановлен побайтно, Mailpit остановлен |
| **BACKUP** | PRODUCTION: `/var/backups/primetime/pb_data-20261030-123717-293514.tar.gz` (SHA-256 `77cbebb22de7da58…`); `backup-check`: читается, контрольные суммы и SQLite integrity OK, 6 аккаунтов / 5 сохранений = база, журнал счетов (9 заказов) внутри. Плюс копия от `update.sh`: `pb_data-20261030-123804-293706.tar.gz` |
| **SERVER** | 1.9.0, health 200; миграции `1793100000`, `1793200000`, `1793300000` применены; `PRIME_LEAGUE=on`, `PRIME_LEAGUE_TOKENS=on`, `PRIME_LEAGUE_UPGRADES` off, `PRIME_LEAGUE_SEASON_START=2026-11-02`; `SIM_VERSION` `76236bbb2e281ec4`; PRIME SHOP: live, продажи open, ready, чеки on |
| **GITHUB / SITE** | Коммит **`f33d63b`** в `AertoNik/PRIME-TIME-SHOWDOWN` (main); Actions [41057026983](https://github.com/AertoNik/PRIME-TIME-SHOWDOWN/actions/runs/41057026983) — build и deploy success; **https://primetimeshowdown.online** отдаёт `assets/index-DFEnDxan.js` (= сборка коммита), на экране «ALPHA 1.9.0 · PRIME LEAGUE» |
| **PLAYER SAFETY** | До и после: аккаунтов 6, сохранений 5, заказов 9 (оплачено 5), прав 5, согласий 26. Оферта **редакция 3** (sha `40681c01fb585828…`, страница «Редакция № 3 · действует с 30 октября 2026»). Регистрация public, RU:14, `PRIME_SHOP_MINORS=on`, `PRIME_PAY_MODE=live`, `PRIME_SHOP_SALES=open`. `payments.js` и прочие 12 модулей оплаты / документов / возраста не менялись |
| **UNTESTED** | Реальные iPhone / Android (владелец — после выпуска). Полная дуэль на PRODUCTION аккаунтом владельца — **NOT TESTED ON PRODUCTION** (вход требует пароль владельца; тестовые аккаунты на PRODUCTION не создавались). Нагрузка выше 5 одновременных завершений. Боевая почта и реальный платёж — не трогались |
| **ROLLBACK** | Лига мешает → `PRIME_LEAGUE=` и перезапуск (продажи не затрагиваются; env до включения: `/etc/primetime/pocketbase.env.pre-league-202610301244`). Код сервера → `/opt/primetime/*.previous` (1.8.9.5) или архив `prime-server-1.8.9.5-alpha.tar.gz` (`8cb5e402…`) через `update.sh`. Сайт → `git revert f33d63b` (точка возврата `c4fe27b`). **Базу не откатывать** |

## 2. Что исправлено в финальном цикле

1. **PRIME CHALLENGE +40** (`backend/pb_hooks/lib/league.js`; клиент `LeagueScreen.ts`, `LeagueApi.ts`, `main.css`):
   - отдельная запись журнала `challenge`, ключ `s<сезон>:r<ранг>` — уникальный индекс, ни повтор, ни гонка вторую выплату не дают;
   - в итоге боя — золотой бейдж «+40 TOKENS за PRIME CHALLENGE»;
   - во вкладке наград честно сказано, что жетоны пока копятся, а применение появится в следующих версиях.
2. **Лимиты частоты** (`backend/pb_migrations/1793300000_prime_league_limits.js`, `league.js`; клиент `LeagueRuntime.ts`, `LeagueScreen.ts`, `AccountRuntime.ts`):
   - `/api/prime/league/` для вошедших — 180 в минуту с IP;
   - бюджет аккаунта — 90 в минуту, записи 20;
   - 429 `too_many_requests` + `Retry-After`; клиент ждёт и повторяет не больше 3 раз;
   - остальные правила, гости и `guard.js` не менялись.
3. **Переключатель «Защита в эфире»** (`LeagueScreen.ts`, `main.css`):
   - причина: flex-строка сжимала кнопку до 21–25 px, ползунок уезжал за дорожку и край карточки;
   - теперь 52×30, область нажатия 60×44, фокус, disabled / `aria-busy`, reduced motion;
   - скриншоты: `preview-screens/1.9.0/14-defense-switch-before-after.jpg`, `15-defense-switch-before-staging-375.jpg`; стенд: `preview-screens/defense-switch.html`.
4. **Ранее найдено на STAGING и вошло в выпуск:**
   - отпечаток боя на шаге окончания (хеш игры = хеш сервера);
   - прокрутка и фокус экрана лиги;
   - студия на 320 px, Esc;
   - склонения.

## 3. Проверка сайта после выпуска

1. **Лига выключена** (сразу после сервера):
   - версия 1.9.0;
   - «В БОЙ!» ведёт в карьеру, лиги нет;
   - карьерный бой идёт;
   - PRIME ID → «Настроить образ»: 14 портретов, 4 рамки, 4 фона, пояснение для гостя;
   - «Оферта» → `legal/ru/offer.html` — «Редакция № 3».
2. **Лига включена** (15:44 МСК): у «В БОЙ!» появился переключатель PRIME LEAGUE; экран лиги «ON AIR» с правилами и «Лига доступна с подтверждённым PRIME ID · ОТКРЫТЬ PRIME ID». Скриншоты: `preview-screens/1.9.0/16-live-league-on-guest.jpg`, `17-live-title-alpha-1.9.0.jpg`.
3. **Наблюдение после включения:**
   - health 200 (< 1 мс), load 0,02;
   - ошибок в журнале 0, `replay differ` 0, 5xx 0, 429 0;
   - профилей лиги пока 0 — игроки ещё не вступали.

## 4. Предсезонье и сезон 1

- `PRIME_LEAGUE_SEASON_START=2026-11-02` = понедельник **02.11.2026 00:00 МСК**.
- До него сервер в сезоне 0 (предсезонье): RP считается, игра показывает «Предсезонье · сезон 1 стартует 02.11».
- В момент старта профили переходят в сезон 1: предсезонье уходит в историю, RP × 0,6 (код и автотесты; на STAGING так же проверена смена сезона 1 → 2).
- Серверное время не менялось.

## 5. Что владельцу проверить самому

1. **Телефон** (iPhone / Android):
   - вход в PRIME ID, «Настроить образ», сохранение;
   - лига: вступить, защита и переключатель, одна дуэль, итог после сервера.
2. **Через сутки:**
   - журнал PocketBase (`_logs`): `replay differ`, 429, 5xx;
   - `prime-shop status`.
