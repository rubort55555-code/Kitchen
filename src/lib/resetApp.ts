// «Обновить приложение»: убирает сохранённые в телефоне файлы приложения и отключает service worker, затем перезагружает.
// Данные (продукты, рецепты, настройки в IndexedDB) и скачанные файлы распознавания чеков не трогаются.
// Трогаем только своё: боевая версия и «зеркало» (…/staging/) живут на одном сайте и не должны сбрасывать друг друга.
import { ownCache } from "./env";

export async function resetApp(): Promise<void> {
  try {
    if ("serviceWorker" in navigator) {
      const scope = new URL("./", location.href).href;
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.filter((r) => r.scope === scope).map((r) => r.unregister()));
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter(ownCache).map((k) => caches.delete(k)));
    }
  } catch { /* перезагрузим всё равно */ }
  location.reload();
}
