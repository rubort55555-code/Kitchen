# Боевая версия и «зеркало» для обкатки на одном сайте не мешают друг другу (браузер).
# Сайт как на GitHub Pages: боевая сборка в корне, зеркало (STAGING=1) в папке staging/.
#   npm run build && npm run build:staging && python3 tests/e2e_staging.py
# Проверяем: у версий разные базы IndexedDB, разные service worker и кэши; первое открытие зеркала не принимается
# за обновление; «Обновить и перезапустить» в зеркале не трогает боевую; без интернета каждая открывает свою страницу;
# у зеркала есть пометка «Тестовая версия».
import os, sys, shutil, tempfile, threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for d in ("dist", "dist-staging"):
    if not os.path.exists(os.path.join(ROOT, d, "index.html")):
        sys.exit(f"Нет сборки {d}/ — запустите npm run build && npm run build:staging")
SITE = tempfile.mkdtemp()
shutil.copytree(ROOT + "/dist", SITE + "/s")
shutil.copytree(ROOT + "/dist-staging", SITE + "/s/staging")
PORT = 8181
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = ThreadingHTTPServer(("127.0.0.1", PORT), partial(Quiet, directory=SITE + "/s"))
threading.Thread(target=srv.serve_forever, daemon=True).start()
PROD = f"http://127.0.0.1:{PORT}/"
STG = PROD + "staging/"

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
def who(pg, name):
    return ((pg.evaluate(READ, name) or {}).get("members") or [{}])[0].get("name")
SW_READY = "() => navigator.serviceWorker.ready.then(() => true)"
REGS = "() => navigator.serviceWorker.getRegistrations().then(rs => rs.map(r => r.scope).sort())"
CTRL = "() => navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL"

with sync_playwright() as p:
    br = p.chromium.launch(executable_path=os.environ.get("CHROMIUM", "/opt/pw-browsers/chromium"))
    ctx = br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    errs = []
    prod = ctx.new_page(); prod.on("pageerror", lambda e: errs.append("боевая: " + str(e)))
    prod.goto(PROD); prod.wait_for_selector("h1")
    prod.evaluate(SEED, ["kitchen", settings("Боевая")]); prod.reload(); prod.wait_for_selector("h1")
    prod.evaluate(SW_READY)

    # Первое открытие зеркала: страницей сначала управляет боевой service worker (его область — весь сайт).
    # Когда зеркало ставит свой, это не обновление: ни перезагрузки, ни предложения «Обновить».
    stg = ctx.new_page(); stg.on("pageerror", lambda e: errs.append("зеркало: " + str(e)))
    navs = []
    stg.on("framenavigated", lambda f: navs.append(f.url) if f == stg.main_frame else None)
    stg.goto(STG); stg.wait_for_selector("h1")
    stg.evaluate(SW_READY); stg.wait_for_timeout(1500)
    ok("первое открытие зеркала — без лишней перезагрузки", len(navs) == 1, navs)
    ok("и без предложения обновиться", "Обновить" not in stg.inner_text("body"))
    stg.evaluate(SEED, ["kitchen-staging", settings("Зеркало")]); stg.reload(); stg.wait_for_selector("h1")

    # Названия и пометка
    ok("заголовок боевой — «Кухня»", prod.title() == "Кухня", prod.title())
    ok("заголовок зеркала — «Кухня · тест»", stg.title() == "Кухня · тест", stg.title())
    ok("у зеркала видна пометка «Тестовая версия»", "Тестовая версия" in stg.inner_text("body"))
    ok("у боевой пометки нет", "Тестовая версия" not in prod.inner_text("body"))

    # Данные раздельно
    dbs = prod.evaluate("() => indexedDB.databases().then(d => d.map(x => x.name).sort())")
    ok("в браузере две базы: kitchen и kitchen-staging", dbs == ["kitchen", "kitchen-staging"], dbs)
    ok("в базе боевой — её данные", who(prod, "kitchen") == "Боевая")
    ok("в базе зеркала — его данные", who(prod, "kitchen-staging") == "Зеркало")
    ls = stg.evaluate("() => Object.keys(localStorage).sort()")
    ok("у каждой версии свой ключ оформления в localStorage", "kitchen-staging-theme" in ls and "kitchen-theme" in ls, ls)

    # Service worker и кэши
    ok("два service worker: для корня и для staging/", prod.evaluate(REGS) == [PROD, STG], prod.evaluate(REGS))
    ok("страницей зеркала управляет его service worker", (stg.evaluate(CTRL) or "") == STG + "sw.js", stg.evaluate(CTRL))
    ok("боевой страницей — боевой", (prod.evaluate(CTRL) or "") == PROD + "sw.js", prod.evaluate(CTRL))
    keys = prod.evaluate("() => caches.keys()")
    ok("кэши раздельно: kitchen@… и kitchen-staging@…", any(k.startswith("kitchen@") for k in keys) and any(k.startswith("kitchen-staging@") for k in keys), keys)

    # Без интернета каждая открывает свою страницу
    ctx.set_offline(True)
    off = ctx.new_page(); off.goto(STG); off.wait_for_selector("h1")
    ok("без интернета staging/ открывает зеркало", off.title() == "Кухня · тест", off.title())
    off.goto(PROD); off.wait_for_selector("h1")
    ok("без интернета корень открывает боевую", off.title() == "Кухня", off.title())
    off.close()
    ctx.set_offline(False)

    # «Обновить и перезапустить» в зеркале не трогает боевую
    stg.click('[aria-label^="Ещё: семья"]'); stg.click("text=О приложении")
    ok("в «О приложении» видна версия зеркала", "staging-" in stg.inner_text("body"))
    with stg.expect_navigation():
        stg.click("text=Обновить и перезапустить приложение")
    stg.wait_for_selector("h1")
    regs = prod.evaluate(REGS)
    ok("после сброса зеркала боевой service worker на месте", PROD in regs, regs)
    keys = prod.evaluate("() => caches.keys()")
    ok("после сброса зеркала боевые кэши на месте", any(k.startswith("kitchen@") for k in keys), keys)
    ok("данные боевой не тронуты", who(prod, "kitchen") == "Боевая")
    ok("данные зеркала после сброса на месте", who(prod, "kitchen-staging") == "Зеркало")
    ok("ошибок на страницах нет", not errs, errs)
    br.close()

srv.shutdown(); shutil.rmtree(SITE, ignore_errors=True)
print(f"\nбоевая версия и зеркало: {sum(res)} из {len(res)}")
sys.exit(0 if all(res) else 1)
