// Service worker: сохраняет файлы приложения в телефон, чтобы оно открывалось без интернета.
const VERSION = "%VERSION%";
const CACHE = "kitchen-" + VERSION;
const FILES = %FILES%;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
});

// Приложение само просит включить новую версию, когда пользователь нажал «Обновить».
self.addEventListener("message", (e) => {
  if (e.data === "skipWaiting") self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("kitchen-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Файлы распознавания текста (около 15 МБ) скачиваются один раз при первом распознавании чека
// и дальше хранятся в телефоне отдельно — при обновлении приложения они не скачиваются заново.
const OCR_CACHE = "ocr-v1";

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // version.json всегда из сети — по нему видно, есть ли обновление.
  if (url.pathname.endsWith("/version.json")) return;
  if (req.mode === "navigate") {
    e.respondWith(caches.match("./", { ignoreSearch: true }).then((r) => r || fetch(req)));
    return;
  }
  if (url.pathname.includes("/ocr/") && !/(tesseract|worker)\.min\.js$/.test(url.pathname)) {
    e.respondWith(
      caches.open(OCR_CACHE).then((c) => c.match(req).then((r) => r || fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; })))
    );
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((r) => r || fetch(req)));
});
