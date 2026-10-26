# Обновление рецептов и справочника с сайта (в браузере и как в приложении для Android): python3 tests/e2e_content.py
import hashlib, json, os, shutil, tempfile, threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
SITE = "https://rubort55555-code.github.io/Kitchen/"
PORT = 8125

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")  # «сайт» меняется по ходу проверки
        super().end_headers()

res = []
def ok(name, cond, extra=""):
    res.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond or not extra else " | " + str(extra)[:300]))

def publish(d, change):
    """Новая версия базы на «сайте» d: меняем первую часть рецептов и оглавление."""
    idx = json.load(open(os.path.join(d, "recipes.json")))
    p0 = idx["parts"][0]
    part = json.load(open(os.path.join(d, p0["f"])))
    old_ids = {r["id"] for r in part}
    change(part)
    idx["ids"] = [r["id"] for r in part] + [i for i in idx["ids"] if i not in old_ids]
    idx["total"] = len(idx["ids"])
    text = json.dumps(part, ensure_ascii=False, separators=(",", ":"))
    open(os.path.join(d, p0["f"]), "w").write(text)
    p0["h"] = hashlib.md5(text.encode()).hexdigest()[:8] + "-" + str(len(part)); p0["n"] = len(part)
    idx["at"] = idx["at"] + 1000
    json.dump(idx, open(os.path.join(d, "recipes.json"), "w"))
    return part

IDB = """(q) => new Promise((ok, no) => { const r = indexedDB.open('kitchen'); r.onerror = () => no(r.error);
  r.onsuccess = () => { const t = r.result.transaction(q.store, q.put ? 'readwrite' : 'readonly'); const s = t.objectStore(q.store);
    const g = q.put ? (q.key == null ? s.put(q.put) : s.put(q.put, q.key)) : s.get(q.key); g.onsuccess = () => ok(g.result ?? null); g.onerror = () => no(g.error); } })"""

def wait_all(pg, total):
    pg.click(".tabs button >> text=Рецепты")
    pg.wait_for_selector(f'select[aria-label="Кухня"] option:text("Все ({total})")', state="attached", timeout=30000)

base_dir = tempfile.mkdtemp()
web = os.path.join(base_dir, "web"); shutil.copytree(DIST, web)
srv = ThreadingHTTPServer(("127.0.0.1", PORT), partial(Quiet, directory=web))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{PORT}/"
total = json.load(open(os.path.join(DIST, "recipes.json")))["total"]
first = json.load(open(os.path.join(DIST, "recipes", "00.json")))
A, B = first[0], first[1]  # A исправим в базе, B поправит сам человек

with sync_playwright() as p:
    br = p.chromium.launch()

    # ---- браузер: сайт обновили — исправленный рецепт обновился, свой — нет, новый добавился ----
    S = "[сайт] "
    ctx = br.new_context(viewport={"width": 390, "height": 844}, service_workers="block")
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_selector("h1"); wait_all(pg, total)
    mine = pg.evaluate(IDB, {"store": "recipes", "key": B["id"]})
    mine["steps"] = ["Моя версия шага"]
    pg.evaluate(IDB, {"store": "recipes", "key": None, "put": mine})
    fav = pg.evaluate(IDB, {"store": "recipes", "key": A["id"]}); fav["fav"] = True
    pg.evaluate(IDB, {"store": "recipes", "key": None, "put": fav})
    def change(part):
        part[0]["steps"] = part[0]["steps"] + ["Новый шаг из обновления."]
        part[1]["steps"] = part[1]["steps"] + ["Этот шаг не должен попасть к человеку."]
        part.append({**part[2], "id": "b-test-new", "name": "Новый рецепт из обновления"})
    publish(web, change)
    pg.reload(); pg.wait_for_selector("h1"); wait_all(pg, total + 1)
    a = pg.evaluate(IDB, {"store": "recipes", "key": A["id"]})
    b = pg.evaluate(IDB, {"store": "recipes", "key": B["id"]})
    n = pg.evaluate(IDB, {"store": "recipes", "key": "b-test-new"})
    ok(S + "исправленный в базе рецепт обновился", a and a["steps"][-1] == "Новый шаг из обновления.", a and a["steps"])
    ok(S + "избранное у обновлённого рецепта сохранилось", a and a.get("fav") is True)
    ok(S + "рецепт, который человек поправил сам, не затёрт", b and b["steps"] == ["Моя версия шага"], b and b["steps"])
    ok(S + "новый рецепт добавился", n and n["name"] == "Новый рецепт из обновления")
    # рецепты, которых в базе больше нет: обычный уходит, личный (избранное) и свой остаются
    old = {**A, "id": "b-test-gone", "name": "Убранный из базы"}
    pg.evaluate(IDB, {"store": "recipes", "key": None, "put": {k: v for k, v in old.items() if k != "fav"}})
    pg.evaluate(IDB, {"store": "recipes", "key": None, "put": {**old, "id": "b-test-gone-fav", "name": "Убранный, но в избранном", "fav": True}})
    pg.evaluate(IDB, {"store": "recipes", "key": None, "put": {**old, "id": "b-test-own", "name": "Свой рецепт", "source": "manual"}})
    pg.reload(); pg.wait_for_selector("h1"); wait_all(pg, total + 3)
    ok(S + "убранный из базы рецепт удалён из телефона", pg.evaluate(IDB, {"store": "recipes", "key": "b-test-gone"}) is None)
    ok(S + "убранный из базы, но в избранном — остался", pg.evaluate(IDB, {"store": "recipes", "key": "b-test-gone-fav"}) is not None)
    ok(S + "свой рецепт остался", pg.evaluate(IDB, {"store": "recipes", "key": "b-test-own"}) is not None)
    ok(S + "нет ошибок JS", not errs, errs[:3])
    ctx.close()

    # ---- приложение (Android): базы с сайта, если они новее встроенных ----
    S = "[приложение] "
    site = os.path.join(base_dir, "site"); shutil.copytree(DIST, site)
    publish(site, lambda part: part[0].update(steps=part[0]["steps"] + ["Шаг с сайта."]))
    cat = json.load(open(os.path.join(site, "catalog.json")))
    cat["items"].append({"n": "Продукт с сайта", "c": "Готовое", "e": "🍲", "u": "г", "p": "Холодильник", "d": [3, None, None], "s": ["сайтовый"]})
    cat["at"] += 1000; cat["h"] = "new-" + str(len(cat["items"]))
    json.dump(cat, open(os.path.join(site, "catalog.json"), "w"), ensure_ascii=False)
    shutil.rmtree(web); shutil.copytree(DIST, web)  # в приложении — встроенная (старая) версия
    hits = []
    def serve_site(route):
        f = os.path.join(site, route.request.url[len(SITE):].split("?")[0])
        hits.append(os.path.basename(f))
        route.fulfill(path=f, headers={"Access-Control-Allow-Origin": "*", "Content-Type": "application/json"})
    def native_ctx():
        c = br.new_context(viewport={"width": 390, "height": 844}, service_workers="block")
        c.add_init_script("window.androidBridge = { postMessage() {} };")
        return c
    ctx = native_ctx()
    ctx.route(SITE + "**", serve_site)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_selector("h1"); wait_all(pg, total)
    pg.wait_for_timeout(1500)
    a = pg.evaluate(IDB, {"store": "recipes", "key": A["id"]})
    ok(S + "рецепты взяты с сайта", a and a["steps"][-1] == "Шаг с сайта.", a and a["steps"])
    ok(S + "оглавление и части скачаны с сайта", "recipes.json" in hits and "00.json" in hits, hits)
    saved = pg.evaluate(IDB, {"store": "kv", "key": "catalog"})
    ok(S + "справочник с сайта сохранён в телефоне", saved and saved.get("h") == cat["h"] and len(saved["items"]) == len(cat["items"]), saved and saved.get("h"))
    pg.click(".tabs button >> text=Главная")
    pg.click('[aria-label="Ещё: семья, ограничения, данные"]')
    pg.click("text=О приложении")
    about = pg.locator(".screen").last.inner_text()
    ok(S + "в «О приложении» видны даты баз", "База рецептов" in about and "Справочник продуктов" in about, about[:200])
    ok(S + "нет ошибок JS", not errs, errs[:3])
    ctx.close()

    # ---- приложение без интернета: работает на встроенных базах ----
    S = "[без интернета] "
    ctx = native_ctx()
    ctx.route(SITE + "**", lambda r: r.abort())
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_selector("h1"); wait_all(pg, total)
    a = pg.evaluate(IDB, {"store": "recipes", "key": A["id"]})
    ok(S + "встроенные рецепты загружены", a and a["steps"] == A["steps"], a and a["steps"])
    ok(S + "нет ошибок JS", not errs, errs[:3])
    ctx.close()

    # ---- на сайте база старее встроенной (приложение новее сайта): берём встроенную ----
    S = "[сайт старее] "
    old = os.path.join(base_dir, "old"); shutil.copytree(DIST, old)
    publish(old, lambda part: part[0].update(steps=["Старый шаг."]))
    idx = json.load(open(os.path.join(old, "recipes.json"))); idx["at"] -= 5000
    json.dump(idx, open(os.path.join(old, "recipes.json"), "w"))
    site = old
    ctx = native_ctx()
    ctx.route(SITE + "**", serve_site)
    pg = ctx.new_page()
    pg.goto(URL); pg.wait_for_selector("h1"); wait_all(pg, total)
    a = pg.evaluate(IDB, {"store": "recipes", "key": A["id"]})
    ok(S + "старая база с сайта не применяется", a and a["steps"] == A["steps"], a and a["steps"])
    ctx.close()
    br.close()
srv.shutdown()
shutil.rmtree(base_dir, ignore_errors=True)
print(f"\nОбновление баз: {sum(r[1] for r in res)} из {len(res)}")
if not all(r[1] for r in res): raise SystemExit(1)
