# Рабочая версия и тестовая копия на одном сайте не мешают друг другу (браузер).
# Сайт как на GitHub Pages: рабочая сборка в корне, тестовая копия в папке test/.
#   npm run build && npm run build:test && python3 tests/e2e_channels.py
# Проверяем: у копий разные базы IndexedDB, разные service worker и кэши; «Обновить и перезапустить» в тестовой
# копии не трогает рабочую; без интернета каждая открывает свою страницу; у тестовой есть пометка «ТЕСТ».
import os, sys, shutil, tempfile, threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for d in ("dist", "dist-test"):
    if not os.path.exists(os.path.join(ROOT, d, "index.html")):
        sys.exit(f"Нет сборки {d}/ — запустите npm run build && npm run build:test")
SITE = tempfile.mkdtemp()
shutil.copytree(ROOT + "/dist", SITE + "/s")
shutil.copytree(ROOT + "/dist-test", SITE + "/s/test")
PORT = 8180
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = ThreadingHTTPServer(("127.0.0.1", PORT), partial(Quiet, directory=SITE + "/s"))
threading.Thread(target=srv.serve_forever, daemon=True).start()
PROD = f"http://127.0.0.1:{PORT}/"
TEST = PROD + "test/"

res = []
def ok(name, cond, extra=""):
    res.append(bool(cond)); print(("PASS " if cond else "FAIL ") + name + ("" if cond or not extra else " | " + str(extra)[:300]))

# Запись настроек прямо в базу нужного имени (как в других сценариях, но с выбором базы)
SEED = """([name, settings]) => new Promise((res, rej) => {
  const r = indexedDB.open(name);
  r.onsuccess = () => { const db = r.result; const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(settings, 'settings'); tx.oncomplete = () => { db.close(); res(true); }; };
  r.onerror = () => rej(r.error);
})"""
READ = """(name) => new Promise((res) => {
  const r = indexedDB.open(name);
  r.onsuccess = () => { const db = r.result;
    if (!db.objectStoreNames.contains('kv')) { db.close(); return res(null); }
    const q = db.transaction('kv').objectStore('kv').get('settings'); q.onsuccess = () => { db.close(); res(q.result || null); }; };
  r.onerror = () => res(null);
})"""
V = "2026-11-10"
def settings(who):
    return {"tipsSeen": ["intro", "home-gear", "menu"], "lastBackup": 1999999999999, "seenNews": "2099-01-01",
            "consent": {k: {"version": V, "at": 1} for k in ("policy", "health", "off")},
            "members": [{"id": "m1", "name": who, "allergies": [], "dislikes": []}]}
SW_READY = "() => navigator.serviceWorker.ready.then(() => true)"
REGS = "() => navigator.serviceWorker.getRegistrations().then(rs => rs.map(r => r.scope).sort())"
CACHES = "() => caches.keys()"

with sync_playwright() as p:
    br = p.chromium.launch(executable_path=os.environ.get("CHROMIUM", "/opt/pw-browsers/chromium"))
    ctx = br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    errs = []
    prod = ctx.new_page(); prod.on("pageerror", lambda e: errs.append("prod: " + str(e)))
    prod.goto(PROD); prod.wait_for_selector("h1")
    prod.evaluate(SEED, ["kitchen", settings("Рабочая")]); prod.reload(); prod.wait_for_selector("h1")
    prod.evaluate(SW_READY)

    test = ctx.new_page(); test.on("pageerror", lambda e: errs.append("test: " + str(e)))
    test.goto(TEST); test.wait_for_selector("h1")
    test.evaluate(SEED, ["kitchen-test", settings("Тестовая")]); test.reload(); test.wait_for_selector("h1")
    test.evaluate(SW_READY)

    # Названия и пометка
    ok("заголовок рабочей — «Кухня»", prod.title() == "Кухня", prod.title())
    ok("заголовок тестовой — «Кухня ТЕСТ»", test.title() == "Кухня ТЕСТ", test.title())
    ok("у тестовой видна пометка «ТЕСТ»", "ТЕСТ" in test.inner_text("body"))
    ok("у рабочей пометки нет", "ТЕСТ" not in prod.inner_text("body"))

    # Данные раздельно
    dbs = prod.evaluate("() => indexedDB.databases().then(d => d.map(x => x.name).sort())")
    ok("в браузере две базы: kitchen и kitchen-test", dbs == ["kitchen", "kitchen-test"], dbs)
    ok("в базе рабочей — её данные", (prod.evaluate(READ, "kitchen") or {}).get("members", [{}])[0].get("name") == "Рабочая")
    ok("в базе тестовой — её данные", (prod.evaluate(READ, "kitchen-test") or {}).get("members", [{}])[0].get("name") == "Тестовая")
    # localStorage общий на сайт: у каждой копии свой ключ оформления
    ls = test.evaluate("() => Object.keys(localStorage).sort()")
    ok("у тестовой свой ключ оформления в localStorage", "kitchen-test-theme" in ls and "kitchen-theme" in ls, ls)

    # Service worker и кэши
    ok("два service worker: для корня и для test/", prod.evaluate(REGS) == [PROD, TEST], prod.evaluate(REGS))
    test.reload(); test.wait_for_selector("h1")
    ok("тестовой страницей управляет её service worker", (test.evaluate("() => navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL") or "").endswith("/test/sw.js"))
    ok("рабочей страницей — рабочий", (prod.evaluate("() => navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL") or "") == PROD + "sw.js")
    keys = prod.evaluate(CACHES)
    ok("кэши раздельно: kitchen-… и kitchentest-…", any(k.startswith("kitchen-") for k in keys) and any(k.startswith("kitchentest-") for k in keys), keys)

    # Без интернета каждая открывает свою страницу
    ctx.set_offline(True)
    off = ctx.new_page(); off.goto(TEST); off.wait_for_selector("h1")
    ok("без интернета test/ открывает тестовую копию", off.title() == "Кухня ТЕСТ", off.title())
    off.goto(PROD); off.wait_for_selector("h1")
    ok("без интернета корень открывает рабочую", off.title() == "Кухня", off.title())
    off.close()
    ctx.set_offline(False)

    # «Обновить и перезапустить» в тестовой не трогает рабочую
    test.click('[aria-label^="Ещё: семья"]'); test.click("text=О приложении")
    ok("в «О приложении» видна тестовая версия", "-test" in test.inner_text("body"))
    with test.expect_navigation():
        test.click("text=Обновить и перезапустить приложение")
    test.wait_for_selector("h1")
    regs = prod.evaluate(REGS)
    ok("после сброса тестовой рабочий service worker на месте", PROD in regs, regs)
    keys = prod.evaluate(CACHES)
    ok("после сброса тестовой рабочие кэши на месте", any(k.startswith("kitchen-") for k in keys), keys)
    ok("данные рабочей не тронуты", (prod.evaluate(READ, "kitchen") or {}).get("members", [{}])[0].get("name") == "Рабочая")
    ok("данные тестовой после сброса на месте", (prod.evaluate(READ, "kitchen-test") or {}).get("members", [{}])[0].get("name") == "Тестовая")
    ok("ошибок на страницах нет", not errs, errs)
    br.close()

srv.shutdown(); shutil.rmtree(SITE, ignore_errors=True)
print(f"\nрабочая и тестовая копия: {sum(res)} из {len(res)}")
sys.exit(0 if all(res) else 1)
