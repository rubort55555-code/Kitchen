// «Обновить приложение»: убирает сохранённые в телефоне файлы приложения и отключает service worker, затем перезагружает.
// Данные (продукты, рецепты, настройки в IndexedDB) и скачанные файлы распознавания чеков не трогаются.
export async function resetApp(): Promise<void> {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("kitchen-")).map((k) => caches.delete(k)));
    }
  } catch { /* перезагрузим всё равно */ }
  location.reload();
}
