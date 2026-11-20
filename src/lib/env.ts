// Какая это сборка: боевая или «зеркало» для обкатки крупных изменений (собирается с STAGING=1).
// Зеркало живёт на том же сайте по адресу …/Kitchen/staging/, поэтому всё, что браузер хранит на сайт целиком,
// у него своё: база, кэш файлов, ключи в localStorage, канал между вкладками. Данные двух версий не пересекаются.
export const STAGING: boolean = typeof __STAGING__ !== "undefined" && __STAGING__;

/** Пространство имён: имя базы IndexedDB и префикс всех ключей. */
export const NS = STAGING ? "kitchen-staging" : "kitchen";

/** Префикс кэшей service worker'а этой сборки (см. src/sw.js). */
export const CACHE_PREFIX = NS + "@";

/** Кэш принадлежит этой сборке? У боевой версии сюда же попадают кэши старого вида «kitchen-<версия>». */
export const ownCache = (k: string): boolean => k.startsWith(CACHE_PREFIX) || (!STAGING && /^kitchen-\d/.test(k));
