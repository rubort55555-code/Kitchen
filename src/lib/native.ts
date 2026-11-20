// Приложение для Android/iOS (Capacitor): то, что в браузере делается иначе.
import { Capacitor } from "@capacitor/core";
import { IS_TEST, SITE_ROOT } from "./channel";

/** true — открыто как приложение из магазина или APK, false — в браузере. */
export const isNative = Capacitor.isNativePlatform();

/** Сайт приложения: оттуда приложение из магазина берёт свежие рецепты и справочник. Тестовое — с тестовой копии сайта. */
export const SITE = IS_TEST ? SITE_ROOT + "test/" : SITE_ROOT;

/** Файл с сайта (null — нет интернета или сайт не ответил за 8 секунд). */
export async function fetchSite<T>(file: string): Promise<T | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(SITE + file, { cache: "no-cache", signal: ctl.signal });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Сохранить файл через системное меню «Поделиться» (Google Диск, Telegram, «Файлы» и т. д.). */
export async function shareFile(name: string, text: string, title: string) {
  const { Filesystem, Directory, Encoding } = await import("@capacitor/filesystem");
  const { Share } = await import("@capacitor/share");
  const { uri } = await Filesystem.writeFile({ path: name, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
  try {
    await Share.share({ title, files: [uri] });
  } catch (e) {
    // Пользователь закрыл меню — как в браузере
    if (/cancel/i.test(String((e as Error)?.message))) { const a = new Error("cancel"); a.name = "AbortError"; throw a; }
    throw e;
  }
}
