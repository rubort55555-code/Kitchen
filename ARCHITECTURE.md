# Архитектура приложения «Кухня»

«Кухня» — офлайн-приложение для телефона: продукты дома, рецепты, меню, покупки, дневник питания, учёт съеденного и выброшенного (в штуках и рублях). Сервера с данными пользователя нет: всё хранится на устройстве.

## 1. Общая схема

```
                        ┌───────────────────────────── GitHub ─────────────────────────────┐
  recipes/*.txt ──┐     │  Actions: deploy.yml ──► GitHub Pages (сайт + recipes.json,      │
  src/lib/catalog*├─► build.mjs ──► dist/      │           catalog.json, version.json, sw.js)  │
  src/**/*.tsx  ──┘     │  android.yml ──► kitchen.apk     ios.yml ──► kitchen-unsigned.ipa │
                        │  worker.yml  ──► Cloudflare Worker (приём сообщений об ошибках)  │
                        └──────────────────────────────────────────────────────────────────┘
                                         │ (HTTPS, только чтение)
             ┌───────────────────────────┴────────────────────────────┐
             ▼                                                        ▼
   PWA в браузере (Safari/Chrome)                       Capacitor-приложение (Android / iOS)
   service worker кэширует все файлы                    файлы лежат внутри APK/IPA,
   и проверяет version.json                             рецепты/справочник подтягиваются с сайта
             │                                                        │
             └──────────────► один и тот же React-код ◄───────────────┘
                                         │
                                IndexedDB «kitchen» (на устройстве)

  Внешние сервисы (по действию пользователя): claude.ai (через ссылку/буфер обмена),
  Open Food Facts (поиск по штрихкоду), Cloudflare Worker /report и /transcribe.
```

Ключевые принципы:

- **Offline-first.** Все данные — в IndexedDB; сеть нужна только для обновлений и необязательных функций.
- **Один код на три платформы.** Веб (PWA), Android и iOS собираются из одного бандла; отличия изолированы в `src/lib/native.ts`.
- **Без бэкенда и ключей.** «Спросить Claude» — это готовый текстовый запрос, который пользователь отправляет в обычный чат и вставляет ответ обратно; ответ разбирает приложение.
- **Чистая логика отдельно от UI.** Расчёты (питание, меню, чеки, правила) — чистые функции в `src/lib/`, покрытые тестами без браузера.

## 2. Технологии

| Слой | Что используется |
|---|---|
| UI | React 19, TypeScript (strict), свой CSS (`src/styles.css`, три темы через `data-theme`) |
| Состояние | Собственный стор на `useSyncExternalStore` (`src/lib/store.ts`, `src/lib/ui.ts`), без Redux/Zustand |
| Хранение | IndexedDB через тонкую обёртку `src/lib/db.ts` (без Dexie) |
| Сборка | esbuild через `build.mjs` → один JS, один CSS, `sw.js` со списком файлов |
| Офлайн | Service worker `src/sw.js` (только в вебе) |
| Нативные оболочки | Capacitor 8 (`android/`, `ios/`), плагины Filesystem, Share, свой `Brightness` |
| OCR чеков | Tesseract.js (только русский язык), файлы в `public/ocr/` |
| Приём обратной связи | Cloudflare Worker (`worker/`), Whisper в Workers AI, GitHub Issues |
| CI/CD | GitHub Actions: Pages, APK, IPA, Worker |

## 3. Структура репозитория

```
src/
  main.tsx          точка входа: тема, рендер, load(), проверка версии, регистрация SW
  App.tsx           корень: вкладки, кнопка «+», стек «листов» (sheets), баннер обновления
  sw.js             service worker (шаблон, build.mjs подставляет VERSION и FILES)
  index.html        шаблон страницы
  styles.css        стили и переменные тем
  screens/          экраны и листы (Home, Products, Recipes, Shop, More, Diary, Nutrition, Receipt, CookMode …)
  components/       переиспользуемые компоненты (ui.tsx, BarcodeScan, RecipeNutrition, BodyLog …)
  lib/              вся логика и данные (≈60 модулей, см. раздел 5)
    catalogData/    справочник продуктов по группам (мясо, молочное, крупы …)
    compositionData.json  таблица состава продуктов (генерируется)
recipes/            база рецептов в текстовом формате (технологические карты)
tools/              генераторы и проверки: recipes.mjs, check-recipes, build-composition, iron-coverage, gen-privacy …
tests/              юнит-тесты *.test.ts и e2e-сценарии e2e_*.py (Playwright), стресс-тесты
worker/             Cloudflare Worker для сообщений об ошибках
public/             статика: иконки, шрифт Manrope, OCR, guide.html, privacy.html, manifest
android/, ios/      проекты Capacitor
literature/         источники для расчётов питания и биодоступности
```

## 4. Слои приложения

### 4.1. Представление (screens / components)

- **Навигация** без роутера. `src/lib/ui.ts` хранит:
  - `tab` — вкладка нижней панели: `home`, `products`, `recipes`, `shop`, `more`;
  - `page` — подстраница раздела «Ещё» (статистика, семья, правила, данные, оформление, питание, приватность …);
  - `sheets` — стек модальных листов (`Sheet` — размеченное объединение по `kind`: `add`, `product`, `recipe`, `cook`, `steps`, `diary`, `meal`, `receipt`, `ask`, `menucheck` …). `App.tsx` рисует все листы стека поверх экрана через `SheetView`.
- **Сценарии запуска** (в `App.tsx`): согласие с политикой → знакомство (`Intro`) для нового пользователя → «Что нового» после обновления → вопрос о просроченных продуктах (раз в день).
- `ErrorBoundary` ловит ошибки рендера; глобальные `error`/`unhandledrejection` идут в `reportError`.

### 4.2. Состояние и действия (store)

`src/lib/store.ts` — единственный источник данных для UI.

```ts
interface State {
  ready; products; log; recipes; meals; settings;
  saveError; baseLoading; contentAt;
}
```

- Подписка компонентов — `useStore(selector)` на базе `useSyncExternalStore`.
- **Каждое действие** (`addProduct`, `writeOff`, `applyCook`, `addMeals`, `setSettings`, `restore` …) сначала обновляет состояние в памяти (UI реагирует сразу), затем сохраняет изменение в IndexedDB через `persist()`. Ошибка записи показывается баннером `saveError`.
- Действия с отменой возвращают объект-«undo» (`Undo`, `CookUndo`) — тост с кнопкой «Отменить».
- **Несколько вкладок:** после записи отправляется сообщение в `BroadcastChannel("kitchen-data")`, остальные вкладки перечитывают базу (с задержкой 50 мс для склейки).
- При загрузке и восстановлении данные проходят через `src/lib/sanitize.ts` — битые записи отбрасываются, неверные настройки заменяются значениями по умолчанию.

### 4.3. Хранилище (db)

`src/lib/db.ts`, база `kitchen`, версия схемы 2:

| Хранилище | Ключ / индекс | Содержимое |
|---|---|---|
| `products` | `id` | продукты дома (место, количество, цена, срок) |
| `log` | `id`, индекс `t` | журнал движения: куплено, съедено, приготовлено, испорчено, выброшено, корректировка |
| `recipes` | `id` | рецепты: из базы (`source: "base"`) и свои, с личными полями (избранное, оценка, фото, заметка) |
| `meals` | `id`, индекс `date` | дневник питания с пищевой ценностью съеденного |
| `kv` | строковый ключ | `settings` (семья, правила, меню, список покупок, вода, замеры …), служебные `baseSeen`, `baseSigs`, `baseParts`, `catalog` |

API: `getAll`, `getKv`/`setKv`, `apply(changes)` — атомарная запись в несколько хранилищ одной транзакцией, `replaceAll` — восстановление из копии. `askPersist()` просит браузер не вычищать данные.

Резервная копия — JSON (`makeBackup` / `restore` в режимах «заменить» и «объединить»); в приложении сохраняется через системное меню «Поделиться».

### 4.4. Доменная логика (`src/lib`)

| Область | Модули |
|---|---|
| Продукты и справочник | `catalog.ts`, `catalogDsl.ts`, `catalogData/`, `units.ts`, `match.ts`, `subs.ts` (замены) |
| Рецепты | `recipeText.ts` (разбор текста), `recipeSteps.ts`, `cuisine.ts`, `garnish.ts`, `timers.ts`, `cook.ts` (списание при готовке) |
| Ограничения семьи | `exclusions.ts` (правила «никогда / немного», аллергии, нелюбимое) |
| Меню | `plan.ts`, `autoplan.ts` (автоподбор под нормы: случайный старт + улучшение заменами), `automenu.ts`, `menucheck.ts` (оценка дня/недели, подгонка порций) |
| Покупки и статистика | `shop.ts`, `stats.ts`, `csv.ts` |
| Питание | `nutrition.ts` (обмен веществ, нормы МР 2.3.1.0253-21), `activities.ts` (MET), `recipeNutrition.ts` + `compositionData.json`, `diary.ts`, `assess.ts`, `goalcheck.ts`, `body.ts`, `fluid.ts`, `vitamins.ts` |
| Усвоение нутриентов | `interactions.ts`, `iron.ts`, `minerals.ts`, `fatsoluble.ts` |
| Ввод данных | `receipt.ts` + `ocr.ts` + `ocrWords.ts` (чеки), `barcode.ts` + `off.ts` (штрихкоды, Open Food Facts), `photo.ts` |
| Интеграции | `claude.ts` (сборка запроса и разбор ответа), `feedback.ts`, `native.ts` |
| Обновления и сервис | `baseSync.ts`, `resetApp.ts`, `whatsnew.ts`, `theme.ts`/`themeRules.ts`, `privacy.ts`/`consent.ts`, `sanitize.ts`, `importOld.ts`, `demo.ts` |

Модули питания и меню — чистые функции (вход → результат), поэтому тестируются без браузера и без IndexedDB.

## 5. Данные-справочники и конвейер контента

```
recipes/*.txt ──tools/recipes.mjs──► проверка формата ──► dist/recipes/NN.json (по 1000) + dist/recipes.json (оглавление)
src/lib/catalog*  ──esbuild──────────────────────────► dist/catalog.json + встроен в бандл
Fineli Rel18 + USDA SR28 + tools/nutrition-map.jsonl ──npm run composition──► src/lib/compositionData.json
```

- **Рецепты** пишутся в текстовом формате технологической карты: заголовок `# Название | вид | минуты | порции | теги`, строка ингредиентов, этапы `*`, шаги `-`, поля `= Выход/Активно/Посуда/Готовность/Подача/Хранение/Ошибка/Совет`. Правила — `tools/REWRITE.md`, проверка — `npm run check-recipes`; при ошибке сборка останавливается.
- **Оглавление `recipes.json`**: `{ v: 2, at, total, parts: [{ f, h, n }], ids }`. `h` — отпечаток части (FNV-1a), `ids` — все рецепты базы.
- **Загрузка базы на устройство** (`seedBase` в `store.ts`): части читаются по очереди, уже загруженные (по отпечатку) пропускаются; приложение готово к работе после первой части.
- **Слияние** (`baseSync.ts`): новые рецепты добавляются; изменённые в базе — обновляются, только если пользователь сам их не правил (сравнение подписей `recipeSig`); удалённые из базы — убираются, если в них нет личного и они не стоят в меню. Избранное, оценки, фото, заметки не затрагиваются.
- **Нативное приложение** при запуске и возврате (не чаще раза в час, `checkContent`) берёт `recipes.json` и `catalog.json` с сайта, если они не старее встроенных (`__BUILT_AT__`).

## 6. Сборка и доставка

`build.mjs`:

1. Вычисляет версию `ГГГГ.ММ.ДД-ЧЧММ-sha` и время сборки.
2. Собирает справочник отдельно → `catalog.json`, отпечаток `__CATALOG_H__`.
3. Собирает `src/main.tsx` esbuild-ом (minify, ESM, `safari15`/`chrome100`), подставляет `__VERSION__`, `__BUILT_AT__`, `__FEEDBACK_URL__`.
4. Копирует `public/`, режет базу рецептов на части, пишет `index.html`, `version.json`.
5. Генерирует `sw.js` со списком файлов для кэша (без `catalog.json`, `guide.html` и тяжёлых данных OCR).

Публикация (GitHub Actions):

| Workflow | Когда | Результат |
|---|---|---|
| `deploy.yml` | push в `main` | `tsc --noEmit` → `npm run build` → GitHub Pages |
| `android.yml` | `main`, `claude/**` | `npm run android` → Gradle → `kitchen.apk` в Releases |
| `ios.yml` | `main`, `claude/**` | `npm run ios` → сборка на macOS без подписи → `kitchen-unsigned.ipa` |
| `worker.yml` | push в `main` | деплой Cloudflare Worker через wrangler |

## 7. Обновление приложения

**Веб (PWA):**
- `sw.js` кэширует все файлы версии в `kitchen-<VERSION>`, старые кэши удаляет при активации.
- Навигация: сначала сеть (`no-cache`, таймаут 3 с), иначе — кэш. Остальные файлы — из кэша.
- Файлы OCR (~15 МБ) кэшируются отдельно в `ocr-v1` при первом распознавании и не перекачиваются при обновлениях.
- `main.tsx` дополнительно сравнивает `__VERSION__` с `version.json` (всегда из сети) и показывает баннер «Есть новая версия»; кнопка вызывает `skipWaiting` или полный сброс кэша (`resetApp.ts`).

**Нативное приложение:** код обновляется новой сборкой APK/IPA; рецепты и справочник — с сайта без новой версии (раздел 5).

## 8. Внешние интеграции

| Интеграция | Как устроена | Данные пользователя |
|---|---|---|
| «Спросить Claude» | `claude.ts` собирает текст запроса (продукты, ограничения семьи, нормы, формат ответа); пользователь отправляет его в claude.ai и вставляет ответ; `parseAnswer` / `parseClaudeReceipt` разбирают его | уходят только по явному действию, через обычный чат |
| Open Food Facts | `off.ts`, бесплатный API по штрихкоду | только код товара |
| OCR чеков | Tesseract.js локально, предобработка фото в `ocr.ts` | не покидают устройство |
| Сообщения об ошибках | `Feedback.tsx` → Worker `/transcribe` (Whisper) и `/report` → GitHub Issue, вложения в ветку `feedback-data` | анонимно, CORS по списку источников, лимит 6 запросов/мин, проверка типов файлов по сигнатуре |

## 9. Платформенные особенности

- `native.ts` — признак `isNative`, загрузка файлов с сайта (`fetchSite`, таймаут 8 с), сохранение файлов через меню «Поделиться» вместо скачивания.
- Свой Capacitor-плагин `Brightness` (Android — `BrightnessPlugin.java`, iOS — `SceneDelegate.swift`) для темы «по яркости экрана»; пороги — `themeRules.ts`.
- Service worker в нативном приложении не регистрируется — файлы уже внутри пакета.

## 10. Качество и проверки

- `npm run check` — проверка типов TypeScript (обязательна во всех workflow).
- Юнит-тесты `tests/*.test.ts` — чистая логика (правила, разбор ответов Claude, питание, меню, чеки, штрихкоды, слияние базы, устойчивость).
- E2E `tests/e2e_*.py` — Playwright: основные сценарии, дневник, меню, обновление, приватность, качество распознавания чеков (`tests/receipts/`).
- Стресс-тесты `tests/stress/` (отчёт `REPORT.md`) и пределы ввода `MAX_PRICE`, `MAX_QTY`, `MAX_GRAMS` в `util.ts`.
- Проверка рецептов при сборке и `tests/recipe-nutrition.test.ts` (каждый ингредиент должен быть в карте состава).

## 11. Приватность

- Данные хранятся только на устройстве; аккаунтов нет.
- Перед началом работы — согласие с политикой (`privacy.ts`, `consent.ts`); текст политики — один источник для экрана и `public/privacy.html` (`npm run privacy`).
- Данные о здоровье (замеры, дневник) можно отозвать и стереть отдельно (`withdrawConsent`, `eraseHealthData`).

## 12. Как добавить новую функцию

1. Чистая логика — новый модуль в `src/lib/` + тест `tests/<имя>.test.ts`.
2. Новые данные — поле в `types.ts`; если это новое хранилище — поднять `DB_VERSION` в `db.ts` и добавить его в `onupgradeneeded`, `sanitize.ts`, резервную копию (`makeBackup`/`restore`).
3. Действие — функция в `store.ts`: обновить состояние → `persist(db.apply(...))`.
4. Экран — компонент в `src/screens/`, новый вид листа — в `Sheet` (`ui.ts`) и `SheetView` (`App.tsx`).
5. Заметное изменение — запись в начало `RELEASES` (`whatsnew.ts`).
