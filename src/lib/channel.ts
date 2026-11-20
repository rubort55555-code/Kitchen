// Канал сборки: рабочая версия или тестовая копия.
// Тестовая копия живёт на том же сайте (папка test/), поэтому у неё свои имена для всего, что браузер хранит
// на весь сайт сразу: база IndexedDB, localStorage, кэши service worker, канал между вкладками.
// Так проверка обновлений не может задеть данные и офлайн-файлы рабочей версии.
// Канал задаётся при сборке: KITCHEN_CHANNEL=test npm run build (см. build.mjs).

export type Channel = "prod" | "test";

export const CHANNEL: Channel = typeof __CHANNEL__ !== "undefined" && __CHANNEL__ === "test" ? "test" : "prod";
export const IS_TEST = CHANNEL === "test";

/** Ветка, из которой собрана тестовая копия (пусто — неизвестно). */
export const BRANCH = typeof __BRANCH__ !== "undefined" ? __BRANCH__ : "";

/** Начало имён в хранилищах браузера: база «kitchen», ключи «kitchen-theme» и т. п. */
export const STORAGE = IS_TEST ? "kitchen-test" : "kitchen";

/**
 * Начало имён кэшей service worker. У тестовой копии — без «kitchen-»: рабочая версия при обновлении
 * удаляет все кэши, которые начинаются с «kitchen-», и так не тронет тестовые (и наоборот).
 */
export const CACHE_PREFIX = IS_TEST ? "kitchentest-" : "kitchen-";

/** Адрес рабочего сайта. */
export const SITE_ROOT = "https://rubort55555-code.github.io/Kitchen/";
