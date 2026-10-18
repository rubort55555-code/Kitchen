# Кухня

Приложение для телефона: что есть дома, что приготовить, сколько продуктов съедено и сколько пропало — в количестве и в рублях.

- Работает без интернета, данные хранятся только в телефоне.
- Бесплатно: без регистрации, платных сервисов и ключей.
- Подбор блюд — кнопкой «Спросить Claude» (открывает обычный чат с готовым запросом).

**Открыть:** https://rubort55555-code.github.io/Kitchen/
На iPhone: Safari → «Поделиться» → «На экран „Домой“».

**Android (тестовая сборка):** страница Releases → «Кухня для Android (тестовая сборка)» → скачать `kitchen.apk` на телефон и открыть. Новая версия ставится поверх старой, данные сохраняются.

**iPhone (тестовая сборка, пока без аккаунта Apple):** страница Releases → «Кухня для iPhone (тестовая сборка)» → `kitchen-unsigned.ipa`. Ставится с компьютера через [Sideloadly](https://sideloadly.io): подключить iPhone кабелем, перетащить файл, войти своим Apple ID. С бесплатным Apple ID приложение работает 7 дней, потом его нужно поставить заново поверх старого — данные сохраняются.

## Для разработчика

- `npm install` и `npm run build` — сборка в папку `dist/`.
- Публикация автоматическая: GitHub Actions собирает и выкладывает на GitHub Pages при каждом изменении в ветке `main`.
- iOS: папка `ios/` (Capacitor, Swift Package Manager). `npm run ios` — собрать и скопировать в проект iOS; приложение собирает `.github/workflows/ios.yml` на Mac в GitHub, без подписи. Тексты разрешений (камера, фото) — `ios/App/App/Info.plist`.
- Android: приложение-обёртка на Capacitor (папка `android/`, настройки — `capacitor.config.json`). `npm run android` — собрать и скопировать в проект Android; APK собирает `.github/workflows/android.yml`. Подпись `android/app/kitchen-test.keystore` — только для тестовых сборок, для Google Play будет отдельный ключ в секретах GitHub. Особенности приложения (меню «Поделиться» вместо скачивания файла и т. п.) — `src/lib/native.ts`.
- Проверки: `tests/logic.test.ts` (правила, разбор ответа Claude), `tests/nutrition.test.ts` и `tests/e2e_nutrition.py` (питание), `tests/barcode.test.ts` (распознавание штрихкодов, разбор Open Food Facts), `tests/e2e.py` и `tests/e2e_barcode.py` (сценарии в браузере, Playwright).
- Штрихкоды: своё распознавание EAN-13/EAN-8/UPC-A (`src/lib/barcode.ts`), поиск товара в Open Food Facts через бесплатный API (`src/lib/off.ts`). Данные © участники Open Food Facts, лицензия ODbL — источник указан рядом с данными.
- Питание (проба): `src/lib/nutrition.ts` — основной обмен (Миффлин — Сан-Жеор), расход по дневнику дня (занятия по времени, код и MET из 2024 Adult Compendium — `src/lib/activities.ts`, ~290 занятий), ИМТ и талия (ВОЗ), нормы БЖУ, клетчатки, витаминов и минералов (МР 2.3.1.0253-21). Экран `src/screens/Nutrition.tsx`.
