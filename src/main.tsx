// Точка входа: загружаем данные, рисуем приложение, включаем работу без интернета.
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { checkContent, load, reportError } from "./lib/store";
import { setUpdate } from "./lib/ui";
import { resetApp } from "./lib/resetApp";
import { isNative } from "./lib/native";
import { startTheme } from "./lib/theme";
import "./styles.css";

window.addEventListener("error", (e) => reportError(e.error || e.message));
window.addEventListener("unhandledrejection", (e) => reportError(e.reason));

startTheme();
createRoot(document.getElementById("root")!).render(<ErrorBoundary><App /></ErrorBoundary>);
load();
// Приложение из магазина: свежие рецепты и справочник с сайта, когда приложение снова открывают
if (isNative) document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkContent(); });

// Новая версия на сайте: сравниваем свой номер с номером на сайте (version.json всегда берётся из сети).
// Если номера разные, показываем «Есть новая версия» с кнопкой, которая сбрасывает сохранённые файлы и перезагружает приложение.
// Это работает, даже если сам service worker по какой-то причине не обновился.
async function checkVersion() {
  if (isNative || typeof __VERSION__ === "undefined" || __VERSION__ === "dev") return;
  try {
    const r = await fetch("./version.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) return;
    const v = (await r.json())?.version;
    if (typeof v === "string" && v && v !== __VERSION__) setUpdate(() => { resetApp(); });
  } catch { /* нет интернета — проверим позже */ }
}
checkVersion();
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkVersion(); });

// Service worker: сохраняет приложение в телефон и сообщает о новой версии.
// В приложении из магазина он не нужен — файлы и так лежат внутри приложения.
if ("serviceWorker" in navigator && location.protocol !== "file:" && !isNative) {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("./sw.js");
      const offer = (w: ServiceWorker) => setUpdate(() => { w.postMessage("skipWaiting"); });
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const w = reg.installing;
        w?.addEventListener("statechange", () => {
          if (w.state === "installed" && navigator.serviceWorker.controller) offer(w);
        });
      });
      // Перезагружаемся только при обновлении (при первой установке перезагрузка не нужна)
      const hadController = !!navigator.serviceWorker.controller;
      let reloaded = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
      // Проверяем обновления каждый раз, когда приложение снова открывают
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
    } catch (e) {
      reportError(e);
    }
  });
}
