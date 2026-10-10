// Точка входа: загружаем данные, рисуем приложение, включаем работу без интернета.
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { load, reportError } from "./lib/store";
import { setUpdate } from "./lib/ui";
import "./styles.css";

window.addEventListener("error", (e) => reportError(e.error || e.message));
window.addEventListener("unhandledrejection", (e) => reportError(e.reason));

createRoot(document.getElementById("root")!).render(<App />);
load();

// Service worker: сохраняет приложение в телефон и сообщает о новой версии.
if ("serviceWorker" in navigator && location.protocol !== "file:") {
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
      let reloaded = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloaded) { reloaded = true; location.reload(); } });
      // Проверяем обновления каждый раз, когда приложение снова открывают
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
    } catch (e) {
      reportError(e);
    }
  });
}
