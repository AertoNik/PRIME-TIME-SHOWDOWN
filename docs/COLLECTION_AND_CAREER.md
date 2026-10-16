# «Моя коллекция», этапы карьеры и новые бойцы (Alpha 1.5)

## 1. «Моя коллекция»

Единственное место, которое владеет косметикой. Все награды — сезонные события, Boss Fight, карьера продюсера — выдаются через `Collection.grant()` (`src/meta/Collection.ts`):

- предмет выдаётся один раз (повторная выдача ничего не меняет и возвращает `false`), записывается в историю (`cosmetics.history`) и сразу надевается в свой слот;
- `setEquipped(id, true/false)` надевает и снимает только то, что реально есть в коллекции; в слоте — один предмет, снятие возвращает стандартный вид;
- `freshCount()` / `markAllSeen()` — отметки NEW (`cosmetics.seen`), их снимает открытие экрана коллекции;
- `achievements()` — достижения, вычисленные из рекордов сохранения: победа над Виктором (`modes.boss`), полный Survival, каждое испытание Prime Challenge, этапы карьеры. Отдельно они не хранятся, поэтому не могут разойтись с реальным прогрессом.

Экран — `src/ui/screens/CollectionScreen.ts` (вкладки «Всё», «Косметика», «Достижения», «Сезоны»). Вид надетых предметов применяет `ThemeManager` (атрибуты `data-card-style`, `data-frame`, `data-title` и т. д. на корне документа) и `BattleView` (эффекты DASH и победы).

**Новый предмет**: добавьте его в `COSMETICS` (`src/config/cosmetics.config.ts`) с полями `slot`, `art`, `rarity`, `source` (`'season' | 'boss' | 'career'`), `sourceLabel`, `howTo` и id в `COSMETIC_ORDER`, затем выдайте его из нужного места через `Collection.grant(id, источник)`. Вид для слота — см. таблицу в `docs/SEASONAL_EVENTS.md`, раздел 7.

## 2. Этапы карьеры продюсера

`CAREER_STAGES` в `src/config/career.ts`: ROOKIE PRODUCER → RISING BROADCAST → PRIME TIME STAR → LEGENDARY PRODUCTION. У этапа есть условия (`milestones`) и разовая награда (`reward`: деньги, репутация, по желанию косметика).

- Условия читают существующие счётчики сохранения (`src/meta/careerStages.ts`, `milestoneValue`): `wins`, `fansEarned`, `signed` (бойцы в составе), `bestRating`, `proWins`, `championWins`, `survivalClears`, `challengeClears`, `bossWins`. Этапы проходятся по порядку.
- Сам этап не хранится — только отметка «награда получена» (`save.careerClaimed`). Поэтому старая карьера признаётся сразу, а награду нельзя получить дважды.
- Выплата — `CareerSystem.claimStage(id)` (кнопка «Забрать» в «Карьере»); косметика уходит в коллекцию.
- Новый этап, достигнутый боем, марафоном, победой над боссом или прохождением испытания, сообщается на экране итогов (`newStage` в результатах `CareerSystem.applyMatch` / `grant`).

**Новый этап или условие**: добавьте запись в `CAREER_STAGES` (и id в `StageId`); новое условие — значение в `MilestoneMetric` и ветку в `milestoneValue`. Экран и проверки подхватят его сами.

## 3. Как подключён новый боец (на примере Кая и Рины)

1. `src/config/types.ts` — id бойца, оружия, пассивки, фирменной карты, стилей анимации.
2. `src/config/fighters.ts` — запись в `FIGHTERS` (статы, контракт, колода, стили) и id в `FIGHTER_ORDER` — этого достаточно для сохранений (новый боец появляется закрытым), меню, экрана бойцов, контрактов и всех режимов.
3. `src/config/cards.ts` и `balance.ts` (`CARD_TUNING`, `PASSIVE_TUNING`) — карта и пассивка; механика — `src/combat/Abilities.ts`, `CombatSystem.ts`; ИИ — `FighterAI.ts`; рейтинг — `BroadcastSystem.ts`.
4. `src/config/looks.ts` + `src/render/FighterModel.ts` — внешность и оружие; `src/config/animation.ts` — походка, отдача, набор из трёх побед (`VICTORY_SETS`); `FighterAnimator.ts` — позы оружия, рывок, ожидание, победы.
5. `src/render/VFX.ts`, `BattleView.ts`, `src/audio/AudioSystem.ts` — эффекты и звук.
6. Проверки: `npm run sim` (прежние бойцы должны совпасть с прошлой версией), `npm run decks`, `npm run modes` (Boss Fight), `npm run saves`, `npm run collection`, `npm run build`.

## 4. Проверки

```bash
npm run collection
```

Выдача без повторов, слоты, NEW, сезонные предметы после конца события, источник титула Виктора, миграция сохранений 1.4.x, этапы по порядку, разовые выплаты, косметика этапов в коллекции, контракты Кая и Рины.
