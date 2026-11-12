# Проверка запасного экрана вместо белого: python3 tests/e2e_crash.py
import os, sys, threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8150
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = ThreadingHTTPServer(("127.0.0.1", PORT), partial(Quiet, directory=os.path.join(ROOT, "dist")))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{PORT}/"
res = []
def ok(name, cond, extra=""):
    res.append(bool(cond)); print(("PASS " if cond else "FAIL ") + name + ("" if cond or not extra else " | " + str(extra)[:300]))
SEED = """(settings) => new Promise((res, rej) => {
  const r = indexedDB.open('kitchen');
  r.onsuccess = () => { const db = r.result; const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(settings, 'settings'); tx.oncomplete = () => { db.close(); res(true); }; };
  r.onerror = () => rej(r.error);
})"""
with sync_playwright() as p:
    br = p.chromium.launch(executable_path=os.environ.get("CHROMIUM", "/opt/pw-browsers/chromium"))
    pg = br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True).new_page()
    pg.goto(URL); pg.wait_for_selector("h1"); pg.wait_for_timeout(1500)
    # Испорченные настройки (например, из старой копии) приложение чинит само и открывается
    pg.evaluate(SEED, {"members": "сломано", "rules": 5, "tipsSeen": 7})
    pg.reload(); pg.wait_for_timeout(3000)
    t = pg.inner_text("body")
    ok("испорченные настройки не ломают приложение: открывается главная", "Приложение не открылось" not in t and pg.query_selector(".tabs") is not None, t[:100])
    # Сбой отрисовки: в приветствие на главной подмешиваем ошибку
    import re
    def broken(route):
        r = route.fetch(); body = r.text()
        body = re.sub(r'let (\w+)=(\w+)\.getHours\(\);return \1<5\?', r'let \1=\2.getHours();if(self.__crash)throw Error("test");return \1<5?', body)
        route.fulfill(response=r, body=body)
    pg.context.close()
    pg = br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, service_workers="block").new_page()
    pg.route("**/app-*.js", broken)
    pg.add_init_script("self.__crash = true")
    pg.goto(URL); pg.wait_for_timeout(3000)
    t = pg.inner_text("body")
    ok("при сбое отрисовки виден запасной экран, а не белый", "Приложение не открылось" in t, t[:100])
    ok("есть кнопка «Обновить приложение»", pg.query_selector("button:has-text('Обновить приложение')") is not None)
    pg.click("button:has-text('Обновить приложение')"); pg.wait_for_timeout(2500)
    ok("кнопка перезагружает страницу и сбрасывает кэш приложения", pg.evaluate("caches.keys().then(k => k.filter(x => x.startsWith('kitchen-')).length)") <= 1)
    # Сторож в index.html: если приложение не появилось за 10 с
    pg2 = br.new_context(viewport={"width": 390, "height": 844}).new_page()
    pg2.route("**/app-*.js", lambda r: r.abort())
    pg2.goto(URL); pg2.wait_for_timeout(11500)
    ok("если скрипт не загрузился, через 10 секунд есть кнопка «Обновить приложение»", pg2.query_selector("#reset") is not None)
    br.close()
bad = res.count(False)
print(f"e2e_crash: {len(res) - bad} из {len(res)}")
sys.exit(1 if bad else 0)
