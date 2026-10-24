# Цены PRIME SHOP (Alpha 1.8.8)

> **Статус (23.10.2026): шесть цен УТВЕРЖДЕНЫ владельцем, цена LUCIEN — только предложена. Настоящие продажи ЗАКРЫТЫ** (`SHOP_SALES_OPEN = false`, на сервере нет `PRIME_PAY_MODE=live`). Утверждение цены не открывает продаж.

## Цены

| Товар | Тип | Цена | Статус |
|---|---|---:|---|
| RAY: NEON RUNNER | облик бойца | 99 ₽ | утверждена 23.10.2026 |
| BRUNO: CASINO BOSS | облик бойца | 149 ₽ | утверждена 23.10.2026 |
| PRIME BROADCAST | предмет оформления | 49 ₽ | утверждена 23.10.2026 |
| PHANTOM DASH | предмет оформления | 49 ₽ | утверждена 23.10.2026 |
| GOLDEN CONFETTI | предмет оформления | 49 ₽ | утверждена 23.10.2026 |
| VHS CARD FRAME | предмет оформления | 49 ₽ | утверждена 23.10.2026 |
| LUCIEN: THE NIGHT STAR | открытие игрового персонажа | 299 ₽ | **только предложена**: сезонный персонаж; за деньги не продаётся до конца события и отдельного решения владельца; в демонстрации не продаётся никогда |

Где: `src/config/shop.config.ts` — `SHOP_PRICES_RUB` (цены), `SHOP_PRICE_STATUS` (решение **по каждому товару**: `approved` / `proposed`), `SHOP_PRICES_APPROVED_ON`. Неутверждённая цена нигде не показывается и не списывается («Цена уточняется», `price_pending`).

## Цена товара и сумма платежа — разные вещи

| Режим сервера | Цена в каталоге | Сумма на странице Robokassa |
|---|---|---|
| production, `live` (настоящие продажи, позже) | утверждённая цена | та же |
| production, `demo` (демонстрация) | утверждённая цена | та же, **в тестовом режиме** — деньги не списываются; везде «ТЕСТОВАЯ ПОКУПКА — НАСТОЯЩИЕ ДЕНЬГИ НЕ СПИСЫВАЮТСЯ» |
| staging, `test` | утверждённая цена | `SHOP_TEST_PRICES_RUB` (10 ₽); рядом с ценой — «Тестовая оплата 10 ₽ · деньги не списываются» |
| без оплаты | утверждённая цена | — («ПОКА НЕ В ПРОДАЖЕ») |

Публичная конфигурация сервера отдаёт обе величины: `shop.prices` (цены товаров) и `shop.charge` (сумма платежа в этом режиме).

## Единый источник

```
src/config/shop.config.ts ──npm run backend:rules──▶ backend/pb_hooks/lib/shop_rules.js (prices: только утверждённые)
        │                                                     │
        │                         GET /api/prime/config → shop.prices / shop.charge → каталог PRIME SHOP
        │                         POST /api/prime/shop/checkout → сумма заказа → OutSum и подпись Robokassa
        └── npm run legal:release → таблица цен на странице /legal/ru/shop.html
```

Браузер присылает только `sku`; сумму ставит сервер (`npm run payments`: «the SERVER price», «the public config…», «demo order: … the REAL price»).

## Как изменить цену или утвердить LUCIEN

1. `src/config/shop.config.ts`: новое значение в `SHOP_PRICES_RUB` и/или `SHOP_PRICE_STATUS.<sku> = 'approved'`, дата в `SHOP_PRICES_APPROVED_ON`.
2. `npm run backend:rules`, затем `npm run shop && npm run checkout && npm run payments` — проверки цен намеренно требуют обновления вместе с решением.
3. Если документы уже опубликованы — `npm run legal:release -- --approved --date=…` (обновит таблицу цен на сайте).
4. Новый архив сервера, публикация — обычным порядком (`docs/RELEASE_1_8_8.md`). Уже созданные заказы оплачиваются по своей сумме.
